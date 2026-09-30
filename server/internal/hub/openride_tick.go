package hub

import (
	"encoding/json"
	"log/slog"
	"slices"
	"strings"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// run ticks the ride once a second until it is over or nobody is on it,
// then asks the hub to forget it. Ends when the room is forgotten or stopped.
func (o *openRide) run(log *slog.Logger) {
	ticker := time.NewTicker(tickInterval)
	defer ticker.Stop()
	for {
		select {
		case <-o.stop:
			return
		case <-ticker.C:
		}
		o.mu.Lock()
		frames := o.tickLocked(o.now())
		over := len(o.clients) == 0 || !o.now().Before(o.plan.endsAt.Add(openRideGrace))
		o.mu.Unlock()
		for c, frame := range frames {
			c.send(frame)
		}
		// Forgotten when empty (#3303); a rider back later makes it again,
		// the bunch re-derived from the flag. Over its grace, it is done.
		if over && (o.forget == nil || o.forget()) {
			logger(log).Info("open ride room let go", "ride", o.plan.id)
			return
		}
	}
}

// phaseAt is where the ride is: the pen until the count-in, the count-in
// until the flag, riding until the plan ends, then done.
// ponytail: the count-in is a session's 10 s until #3087 sets the ride's own.
func (p openRidePlan) phaseAt(now time.Time) string {
	switch {
	case now.Before(p.flagAt.Add(-countdownSeconds * time.Second)):
		return "pen"
	case now.Before(p.flagAt):
		return "countIn"
	case now.Before(p.endsAt):
		return "riding"
	}
	return "done"
}

// rideLocked steps the bunch to now at the plan's curated pace. Caller holds
// o.mu.
func (o *openRide) rideLocked(now time.Time) {
	riding := o.plan.phaseAt(now) == "riding"
	if riding && o.bunch.at.Before(o.plan.flagAt) {
		o.bunch.at = o.plan.flagAt
	}
	o.bunch.ride(now, riding, o.joined, func(at time.Time) planned {
		return planAt(workout.SegmentAt(o.plan.segments, int(at.Sub(o.plan.flagAt)/time.Second)-1))
	})
}

// tickLocked advances the ride and marshals its frame: once for everyone,
// and again only for a rider with somebody on the ride hidden from them —
// never once per viewer. Caller holds o.mu; nothing here does I/O.
func (o *openRide) tickLocked(now time.Time) map[*client][]byte {
	if now.Sub(o.blocksAt) >= openRideBlocksEvery {
		o.rehideLocked()
		o.blocksAt = now
	}
	o.rideLocked(now)
	phase := o.plan.phaseAt(now)
	world := o.bunch.world(false)
	tick := protocol.OpenRideTick{
		At: now.UnixMilli(), Phase: phase,
		BunchM: world.BunchM, Speed: world.SpeedMps,
		Riders: make([]protocol.OpenRideRider, 0, len(o.riders)),
	}
	if phase == "riding" || phase == "done" {
		ended := now
		if ended.After(o.plan.endsAt) {
			ended = o.plan.endsAt
		}
		tick.Elapsed = int(ended.Sub(o.plan.flagAt) / time.Second)
	}
	markers := make(map[string]int, len(o.riders))
	for id, r := range o.riders {
		markers[id] = len(tick.Riders)
		tick.Riders = append(tick.Riders, protocol.OpenRideRider{E: r.e, O: world.Offsets[id]})
	}
	// By ride id, which says nothing: the join order would.
	slices.SortFunc(tick.Riders, func(a, b protocol.OpenRideRider) int { return strings.Compare(a.E, b.E) })
	shared := marshalOpenRide(tick)
	frames := make(map[*client][]byte, len(o.clients))
	own := make(map[string][]byte)
	for c := range o.clients {
		frame, ok := own[c.rider.ID]
		if !ok {
			frame = shared
			if r := o.riders[c.rider.ID]; r != nil && hidesAnyone(r, markers) {
				frame = marshalOpenRide(withoutHidden(tick, o.riders, r))
			}
			own[c.rider.ID] = frame
		}
		if frame != nil {
			frames[c] = frame
		}
	}
	metricOpenRideFrameBytes.Observe(float64(len(shared)))
	return frames
}

// hidesAnyone is whether a rider has somebody on the ride hidden from them.
func hidesAnyone(r *openRider, on map[string]int) bool {
	for id := range r.hidden {
		if _, riding := on[id]; riding {
			return true
		}
	}
	return false
}

// withoutHidden is the frame as one rider may see it: nobody hidden from
// them, either way (#3202), is a marker on their road.
func withoutHidden(tick protocol.OpenRideTick, riders map[string]*openRider, viewer *openRider) protocol.OpenRideTick {
	cut := make(map[string]struct{}, len(viewer.hidden))
	for id := range viewer.hidden {
		if r := riders[id]; r != nil {
			cut[r.e] = struct{}{}
		}
	}
	own := tick
	own.Riders = make([]protocol.OpenRideRider, 0, len(tick.Riders))
	for _, m := range tick.Riders {
		if _, gone := cut[m.E]; !gone {
			own.Riders = append(own.Riders, m)
		}
	}
	return own
}

// marshalOpenRide is one frame, or nil when it will not marshal — a tick
// skipped rather than half a tick sent.
func marshalOpenRide(tick protocol.OpenRideTick) []byte {
	frame, err := json.Marshal(protocol.OpenRideMessage{Tick: &tick})
	if err != nil {
		return nil
	}
	return frame
}
