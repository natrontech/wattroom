package hub

import (
	"fmt"
	"math"
	"slices"
	"sort"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/road"
)

// The roadside on the bunch's road (ADR-0064, #3029): where each spectator
// stands, and the chalk they paint on its climbs. It paints, sounds and informs; nothing here reaches a rider's
// trainer, place or score, and a spectator never picks a rider. Nothing is
// kept past the run — the stands go with the bunch they stood beside.

const standMoveEvery = protocol.RoadsideStandMoveSeconds * time.Second

// stand is one spectator's stand: where on the road, laps unrolled, and
// when they last put it there.
type stand struct {
	u       float64
	movedAt time.Time
}

// roadside takes one spectator's verb, answering the socket when it is
// refused: a deliberate tap the spectator watches for a result (errors.md).
func (h *Hub) roadside(c *client, rm *channelState, rider protocol.Rider, verb protocol.Roadside) {
	now := h.now()
	if !rm.allow("roadside", rider.ID, now, controlMinGap) {
		h.writeError(c, "roadside_rate_limited", "One thing at a time — try again in a moment.")
		return
	}
	if code, message := rm.roadsideVerb(rider.ID, verb, now); code != "" {
		h.writeError(c, "roadside_"+code, message)
	}
}

// roadsideVerb puts one spectator's verb on the session's road, or says why
// not in errors.md's codes.
func (rm *channelState) roadsideVerb(riderID string, verb protocol.Roadside, now time.Time) (code, message string) {
	paint := verb.Kind == protocol.RoadsideKindPaint
	switch {
	case !paint && verb.Kind != protocol.RoadsideKindStand:
		return "validation_error", "The roadside can take a stand or paint a climb, and nothing else."
	case math.IsNaN(verb.AtM) || math.IsInf(verb.AtM, 0) || verb.Lap < 0:
		return "validation_error", "That is not a place on the road."
	case !paint && (verb.Stamp != "" || verb.For != ""):
		return "validation_error", "A stand is a place on the road, with no chalk."
	case paint && !slices.Contains(protocol.RoadsideStamps, verb.Stamp):
		return "validation_error", "That is not one of the chalk stamps."
	case paint && (verb.Stamp == protocol.RoadsideStampInitial) != (verb.For != ""):
		return "validation_error", "Only an initial names a rider, and an initial always does."
	}
	rm.mu.Lock()
	defer rm.mu.Unlock()
	r := rm.raceLocked()
	if r == nil && !rm.session.onRoad() {
		return "invalid_request", "There is no road to stand beside — a stand needs a session riding one."
	}
	if rm.session.rides(riderID) {
		return "forbidden", "You are riding this session. The roadside is everyone who is not."
	}
	if verb.For != "" && !rm.session.rides(verb.For) {
		return "validation_error", "An initial is chalked for a rider riding this session."
	}
	switch {
	case r != nil && paint:
		return r.paintAt(riderID, verb)
	case r != nil:
		return r.standAt(riderID, verb, now)
	case paint:
		return rm.session.bunch.paintAt(riderID, verb)
	}
	return rm.session.bunch.standAt(riderID, verb, now)
}

// roadsideStands is where each spectator stands beside one road, and the
// chalk on it: the bunch's (#3029), or a race's (#3175), whose riders it
// waits for.
type roadsideStands struct {
	stands map[string]*stand
	// Every stamp still ahead of the riders, in the order painted; how many
	// each spectator has painted this ride, and every mark the ride took.
	paint   []chalk
	painted map[string]int
	marks   int
	// The revision the tick carries them under.
	rev int64
}

// chalk is one stamp on the road: who painted it, where, laps unrolled, and
// the start of the climb it is on, by which one spectator paints each climb
// once.
type chalk struct {
	by       string
	stamp    protocol.RoadsideStamp
	forRider string
	u, climb float64
}

// put places a spectator's stand at u, laps unrolled, as docs/SPEC.md "The
// roadside" has it: 300 m – 5 km ahead of the riders' front, moved at most
// once a minute, and never while the riders close on the one held. `front`
// names the riders in the refusal.
func (rs *roadsideStands) put(riderID string, u, front float64, riders string, now time.Time) (code, message string) {
	if ahead := u - front; ahead < protocol.RoadsideStandMinAheadM || ahead > protocol.RoadsideStandMaxAheadM {
		return "validation_error", fmt.Sprintf("A stand goes %d m – %d km ahead of %s.",
			protocol.RoadsideStandMinAheadM, protocol.RoadsideStandMaxAheadM/1000, riders)
	}
	if held := rs.stands[riderID]; held != nil {
		// Frozen near riders (ADR-0064): nothing on the road moves as the
		// riders close on it.
		if held.u-front < protocol.RoadsideStandMinAheadM {
			return "rate_limited", "The riders are nearly at your stand — it stays put until they pass."
		}
		if wait := standMoveEvery - now.Sub(held.movedAt); wait > 0 {
			return "rate_limited", fmt.Sprintf("You moved your stand a moment ago. You can move it again in %d s.", int(math.Ceil(wait.Seconds())))
		}
	}
	if rs.stands == nil {
		rs.stands = make(map[string]*stand)
	}
	rs.stands[riderID] = &stand{u: u, movedAt: now}
	rs.rev++
	return "", ""
}

// chalkUp paints a spectator's stamp at u, laps unrolled, on the climb that
// starts at `climb` (negative off every climb), as docs/SPEC.md "The
// roadside" bounds it: ahead of the riders' front, one per climb, so many a
// spectator, so many on the road at once, so many a ride. `riders` names
// them in the refusal.
func (rs *roadsideStands) chalkUp(riderID string, verb protocol.Roadside, u, front, climb float64, riders string) (code, message string) {
	switch {
	case climb < 0:
		return "validation_error", "Chalk goes on a climb. Try the next one."
	case u <= front:
		return "validation_error", fmt.Sprintf("That spot is behind %s. Chalk the next climb.", riders)
	case rs.painted[riderID] >= protocol.RoadsidePaintPerRide:
		return "rate_limited", fmt.Sprintf("Your %d stamps are down. That is all this ride.", protocol.RoadsidePaintPerRide)
	case rs.marks >= protocol.RoadsideMarksPerRide:
		return "rate_limited", fmt.Sprintf("This ride has its %d marks. That is all this ride.", protocol.RoadsideMarksPerRide)
	case len(rs.paint) >= protocol.RoadsidePaintLive:
		return "rate_limited", fmt.Sprintf("%d stamps lie ahead. Try once %s passes one.", protocol.RoadsidePaintLive, riders)
	}
	for _, c := range rs.paint {
		if c.by == riderID && c.climb == climb {
			return "conflict", "This climb is chalked. Try the next one."
		}
	}
	if rs.painted == nil {
		rs.painted = make(map[string]int)
	}
	rs.paint = append(rs.paint, chalk{by: riderID, stamp: verb.Stamp, forRider: verb.For, u: u, climb: climb})
	rs.painted[riderID]++
	rs.marks++
	rs.rev++
	return "", ""
}

// climbStart is where the climb under m starts, offset by a lap's metres;
// -1 off every climb.
func climbStart(climbs []road.Climb, m, lap float64) float64 {
	for _, c := range climbs {
		if c.StartM <= m && m <= c.TopM {
			return lap + c.StartM
		}
	}
	return -1
}

// settle lets go of every stand the last rider has passed — at or behind
// `passed` — and of every spectator's who has left the roadside: gone from
// the channel (`here`), or riding the session now.
func (rs *roadsideStands) settle(passed float64, here map[string]struct{}, rides func(string) bool) {
	for id, st := range rs.stands {
		if _, present := here[id]; st.u <= passed || !present || rides(id) {
			delete(rs.stands, id)
			rs.rev++
		}
	}
	// Chalk stays where it was painted, until the last rider rides over it.
	ahead := rs.paint[:0]
	for _, c := range rs.paint {
		if c.u > passed {
			ahead = append(ahead, c)
		}
	}
	if len(ahead) < len(rs.paint) {
		rs.rev++
	}
	rs.paint = ahead
}

// snapshot is the roadside as the tick carries it, beside World, each stand
// placed on the road by `place`.
func (rs *roadsideStands) snapshot(place func(u float64) (float64, int)) *protocol.RoadsideState {
	st := &protocol.RoadsideState{Rev: rs.rev}
	for id, s := range rs.stands {
		m, lap := place(s.u)
		st.Stands = append(st.Stands, protocol.RoadsideStand{RiderID: id, AtM: math.Round(m*100) / 100, Lap: lap})
	}
	sort.Slice(st.Stands, func(i, j int) bool { return st.Stands[i].RiderID < st.Stands[j].RiderID })
	for _, c := range rs.paint {
		m, lap := place(c.u)
		st.Paint = append(st.Paint, protocol.RoadsidePaint{RiderID: c.by, Stamp: c.stamp, For: c.forRider, AtM: math.Round(m*100) / 100, Lap: lap})
	}
	return st
}

// along is where a verb asks to be on the bunch's road, laps unrolled;
// false off it.
func (b *bunch) along(verb protocol.Roadside) (float64, bool) {
	if verb.AtM < 0 || verb.AtM > b.road.LengthM || verb.Lap > 0 && !b.loop {
		return 0, false
	}
	return float64(verb.Lap)*b.road.LengthM + verb.AtM, true
}

// standAt puts a spectator's stand where they asked, beside the bunch.
func (b *bunch) standAt(riderID string, verb protocol.Roadside, now time.Time) (code, message string) {
	u, ok := b.along(verb)
	if !ok {
		return "validation_error", "That is not a place on this road."
	}
	return b.roadside.put(riderID, u, b.fromM+b.pace.Distance, "the bunch", now)
}

// paintAt chalks a spectator's stamp where they asked, on a climb ahead of
// the bunch.
func (b *bunch) paintAt(riderID string, verb protocol.Roadside) (code, message string) {
	u, ok := b.along(verb)
	if !ok {
		return "validation_error", "That is not a place on this road."
	}
	climb := climbStart(climbsRidden(b.road, b.reverse), verb.AtM, float64(verb.Lap)*b.road.LengthM)
	return b.roadside.chalkUp(riderID, verb, u, b.fromM+b.pace.Distance, climb, "the bunch")
}

// settleRoadsideLocked lets go of every stand the riders have passed, and of
// every spectator's who has left the roadside: gone from the channel, or
// riding the session now. Caller holds rm.mu.
func (rm *channelState) settleRoadsideLocked() {
	var rs *roadsideStands
	var passed float64
	if r := rm.raceLocked(); r != nil {
		rs, passed = &r.roadside, r.tail()
	} else if b := rm.session.bunch; b != nil {
		rs, passed = &b.roadside, b.fromM+b.pace.Distance
	}
	if rs == nil || len(rs.stands) == 0 && len(rs.paint) == 0 {
		return
	}
	here := make(map[string]struct{}, len(rm.clients))
	for c := range rm.clients {
		here[c.rider.ID] = struct{}{}
	}
	rs.settle(passed, here, rm.session.rides)
}

// roadsideLocked is the roadside on the tick: a race's while the session is
// the race's, else the bunch's while it rides a road. Caller holds rm.mu.
func (rm *channelState) roadsideLocked() *protocol.RoadsideState {
	if r := rm.raceLocked(); r != nil {
		return r.roadsideState()
	}
	if !rm.session.onRoad() {
		return nil
	}
	return rm.session.bunch.roadside.snapshot(rm.session.bunch.place)
}
