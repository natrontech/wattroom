package hub

import (
	"sync"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// Open rides (ADR-0076, #3303): one room per ride, a sibling of a voice
// channel's that shares nothing of it but the client and its keepalive — no
// LiveKit, no deck, no presence pings, no recap, no roster of names. A
// stranger is a per-ride id at a place on the road, one nameless frame a
// second for everyone (protocol/open_ride.go). The door that admits a rider,
// and resolves what the ride may know of them, is #3304's.

// docs/SPEC.md "Open rides" (defaults — tune in alpha), and #3303's grace.
const (
	maxOpenRideRiders = 100
	openRidePen       = 10 * time.Minute
	openRideGrace     = 5 * time.Minute
	// How often who is hidden from whom is read again (#3202): the door's
	// audience refresh, docs/SPEC.md's 60 s.
	openRideBlocksEvery = 60 * time.Second
)

// openRidePlan is an open ride as the door hands it over: the planned
// session its crew opened to everyone (#3300), on its library road as the
// crew's cut, at its curated pace, from its flag.
type openRidePlan struct {
	id       string
	route    *routeRide
	segments []workout.Segment
	flagAt   time.Time
	// The flag plus the plan's length: where the ride is done.
	endsAt time.Time
}

// openRider is one rider on an open ride, as the door admitted them. The
// FTP and weight are read for the bunch and framed nowhere.
type openRider struct {
	id            string
	e             string
	ftp, weightKg int
	lastSeq       int
	// Riders hidden from this one, either way (#3202): their markers are cut
	// from this rider's copy of the frame.
	hidden map[string]struct{}
}

type openRide struct {
	plan  openRidePlan
	now   func() time.Time
	stop  chan struct{}
	hider Hider
	ids   *openRideIDs
	// Asks the hub to forget this ride, reporting whether it did; nil in a
	// ride built without a hub.
	forget func() bool

	mu      sync.Mutex
	clients map[*client]struct{}
	riders  map[string]*openRider
	// Everyone on it, as the bunch reads riders (ADR-0065).
	joined   map[string]struct{}
	bunch    *bunch
	blocksAt time.Time
}

// newOpenRide makes a ride's room, its bunch derived from the flag and the
// plan (ADR-0065's fromM): the same room made again after a restart, or after
// everyone dropped, puts the bunch where the plan has it, offsets from 0.
func newOpenRide(plan openRidePlan, now func() time.Time, hider Hider, ids *openRideIDs) *openRide {
	o := &openRide{
		plan: plan, now: now, stop: make(chan struct{}), hider: hider, ids: ids,
		clients: make(map[*client]struct{}),
		riders:  make(map[string]*openRider),
		joined:  make(map[string]struct{}),
		bunch:   newBunch(plan.route, plan.flagAt),
	}
	o.rideLocked(now())
	return o
}

// joinOpenRide admits one socket to its ride, making the room at the first
// admitted connection. A refusal is for the door to send. A rider's other
// screens join as that rider, and count once against the cap.
//
// Admitted under the hub's lock, taken before the ride's here and in
// forgetOpenRide alike: a socket never joins a room the tick is letting go.
func (h *Hub) joinOpenRide(plan openRidePlan, c *client, ftp, weightKg int) (*openRide, *protocol.Error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	o := h.openRides[plan.id]
	if o == nil {
		o = newOpenRide(plan, h.now, h.hider, h.rideIDs)
		o.forget = func() bool { return h.forgetOpenRide(plan.id, o) }
		h.openRides[plan.id] = o
		go o.run(h.log)
	}
	if refused := o.join(c, ftp, weightKg); refused != nil {
		return nil, refused
	}
	return o, nil
}

// openRideCounts is how many rides are live and how many ride them, for the
// gauges: the hub's lock and a ride's are never held together.
func (h *Hub) openRideCounts() (rooms, riders int) {
	h.mu.Lock()
	live := make([]*openRide, 0, len(h.openRides))
	for _, o := range h.openRides {
		live = append(live, o)
	}
	h.mu.Unlock()
	for _, o := range live {
		o.mu.Lock()
		riders += len(o.riders)
		o.mu.Unlock()
	}
	return len(live), riders
}

// forgetOpenRide drops a ride's room if it is still empty or over — a rider
// may have joined since the tick looked — and closes its stop, for the
// door's sockets to hear. True once the room is gone.
func (h *Hub) forgetOpenRide(id string, o *openRide) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.openRides[id] != o {
		return true
	}
	o.mu.Lock()
	over := len(o.clients) == 0 || !o.now().Before(o.plan.endsAt.Add(openRideGrace))
	o.mu.Unlock()
	if !over {
		return false
	}
	delete(h.openRides, id)
	close(o.stop)
	return true
}

func (o *openRide) join(c *client, ftp, weightKg int) *protocol.Error {
	o.mu.Lock()
	defer o.mu.Unlock()
	id := c.rider.ID
	if _, on := o.riders[id]; !on {
		if len(o.riders) >= maxOpenRideRiders {
			return &protocol.Error{Code: "rate_limited", Message: "This ride is full."}
		}
		now := o.now()
		o.riders[id] = &openRider{
			id: id, e: o.ids.idFor(o.plan.id, id, o.plan.endsAt, now),
			ftp: ftp, weightKg: weightKg, hidden: make(map[string]struct{}),
		}
		o.joined[id] = struct{}{}
		o.hideLocked(id)
	}
	o.clients[c] = struct{}{}
	return nil
}

// leave lets a socket go; a rider's last one takes them off the ride.
func (o *openRide) leave(c *client) {
	o.mu.Lock()
	defer o.mu.Unlock()
	delete(o.clients, c)
	for other := range o.clients {
		if other.rider.ID == c.rider.ID {
			return
		}
	}
	delete(o.riders, c.rider.ID)
	delete(o.joined, c.rider.ID)
	for _, r := range o.riders {
		delete(r.hidden, c.rider.ID)
	}
}

// sample takes one rider's second: watts and bias, bounded, once per seq.
// The bunch reads it; nothing sends it on.
func (o *openRide) sample(c *client, s protocol.OpenRideSample) {
	if s.Watts < 0 || s.Watts > protocol.MaxWatts || s.Bias != 0 && (s.Bias < protocol.MinBias || s.Bias > protocol.MaxBias) {
		return
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	r := o.riders[c.rider.ID]
	if r == nil || s.Seq <= r.lastSeq {
		return
	}
	r.lastSeq = s.Seq
	o.bunch.hear(r.id, protocol.RiderMetrics{Watts: s.Watts, Bias: s.Bias},
		protocol.Rider{FtpWatts: r.ftp, WeightKg: r.weightKg})
}

// hideLocked reads who is hidden from a rider, either way, among everyone
// on the ride. Caller holds o.mu.
func (o *openRide) hideLocked(id string) {
	if o.hider == nil {
		return
	}
	r := o.riders[id]
	for other, them := range o.riders {
		if other != id && o.hider.Hidden(id, other) {
			r.hidden[other] = struct{}{}
			them.hidden[id] = struct{}{}
		}
	}
}

// rehideLocked reads every pair again, a block made or lifted mid-ride
// included. Caller holds o.mu.
func (o *openRide) rehideLocked() {
	for _, r := range o.riders {
		clear(r.hidden)
	}
	for id := range o.riders {
		o.hideLocked(id)
	}
}
