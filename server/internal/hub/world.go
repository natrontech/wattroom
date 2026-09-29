package hub

import (
	"math"
	"sort"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/road"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// roadRidingMps is docs/SPEC.md's "riding on a road" (Route rides): a rider
// on a road is riding while their virtual speed is above it.
// ponytail: hub-local until a client reads it; then protocol/limits.go.
const roadRidingMps = 0.5

// bunchMaxPct is ADR-0065's 150 %: the pace of a sprint block, and the most
// any one rider adds to a road step's live mean.
const bunchMaxPct = 1.5

// routeRide is a road a session rides, as the hub holds it (#3095, #3028):
// the reference every socket is sent, and the crew's cut the bunch climbs —
// its heights, never its turns, so the hub holds no shape (ADR-0063).
type routeRide struct {
	protocol.SessionRoute
	profile road.Road
}

// ref is the reference every socket is sent; nil rides no road.
func (r *routeRide) ref() *protocol.SessionRoute {
	if r == nil {
		return nil
	}
	return &r.SessionRoute
}

// bunch is one road's shared place (ADR-0065): one position, advanced once
// per whole second at the pace the plan sets, never at one rider's. It takes
// riders and a plan, never a room, so an open ride (ADR-0076) can drive the
// same code. Not goroutine-safe; its owner's lock guards it.
//
// ponytail: no corners (#3204) — the bunch rides the reference rider's
// straight-road pace; add CornerLimit when the hub holds a bend's radius,
// which it may without holding the shape.
type bunch struct {
	road          road.Road
	fromM         float64
	reverse, loop bool
	// Distance is metres ridden from fromM, every lap unrolled.
	pace    road.Pace
	climbed float64
	// The last whole second the bunch was stepped to.
	at time.Time
	// This second's samples from the joined riders.
	heard map[string]sample
	// Every joined rider's place in it (#3097), once the plan runs.
	places map[string]*place
	// Where the road's KOM sprints open (#3102), the next one ahead, laps
	// unrolled, while komLeft; how many this ride armed, and when the last
	// one opened.
	koms      []float64
	komU      float64
	komLeft   bool
	komsArmed int
	lastKom   time.Time
}

func newBunch(r *routeRide, now time.Time) *bunch {
	b := &bunch{
		road: r.profile, fromM: r.FromM, reverse: r.Reverse, loop: r.Loop,
		at: now, heard: make(map[string]sample), places: make(map[string]*place),
		koms: komOpenings(r.profile, r.Reverse),
	}
	b.komU, b.komLeft = b.komAt(b.fromM, false)
	return b
}

// hear takes one joined rider's sample into this second.
func (b *bunch) hear(riderID string, m protocol.RiderMetrics, rider protocol.Rider) {
	b.heard[riderID] = sampleOf(m, rider)
}

// ride steps the bunch through every whole second since the last, each at
// the second of the plan planAt answers, and every joined rider's place
// with it. A plan that is not running moves nothing: paused, the bunch
// slows to 0 at once, and what it heard meanwhile is not the first second's.
// ponytail: no cap on the catch-up; the room's clock only moves by real
// time, and the room rides the bunch on every tick, empty or not.
func (b *bunch) ride(now time.Time, running bool, joined map[string]struct{}, planAt func(at time.Time) planned) {
	if !running {
		b.pace.Speed = 0
		b.at = now
		clear(b.heard)
		return
	}
	for !now.Before(b.at.Add(time.Second)) {
		b.at = b.at.Add(time.Second)
		p, live := planAt(b.at), b.livePct()
		b.step(p.watts(live))
		b.settle(joined, p, live)
	}
	clear(b.heard)
}

// livePct is the mean %FTP of the riders pedalling this second, each capped
// at bunchMaxPct so one strong rider cannot tow the bunch; their bias is
// never read — a personal trim must not move everyone's road. Nobody
// pedalling is 0.
func (b *bunch) livePct() float64 {
	sum, n := 0.0, 0
	for _, s := range b.heard {
		if pct := s.pct(); pct > 0 {
			sum += min(pct, bunchMaxPct)
			n++
		}
	}
	if n == 0 {
		return 0
	}
	return sum / float64(n)
}

// planned is one second of the plan as the bunch reads it: a sprint, a
// prescription — as %FTP, or as watts — or neither, which rides the live
// mean.
type planned struct {
	sprint        bool
	pct, absolute float64
}

// planAt is the plan at one second of a workout: a road step, a free block,
// or a game with no blocks at all prescribes nothing.
func planAt(seg workout.Segment, pct float64, inBlock bool) planned {
	switch {
	case !inBlock:
		return planned{}
	case seg.Kind == "sprint":
		return planned{sprint: true}
	case seg.Kind == "steady" && seg.Watts > 0:
		return planned{absolute: seg.Watts}
	}
	return planned{pct: pct}
}

// watts is ADR-0065's table: the reference rider at the block's
// prescription, 150 % through a sprint, and the live mean where nothing is
// prescribed. An absolute-watts block prescribes its watts to the reference
// rider too.
func (p planned) watts(livePct float64) float64 {
	switch {
	case p.sprint:
		return bunchMaxPct * protocol.ReferenceRiderWatts
	case p.absolute > 0:
		return p.absolute
	case p.pct > 0:
		return p.pct * protocol.ReferenceRiderWatts
	}
	return livePct * protocol.ReferenceRiderWatts
}

func (b *bunch) step(watts float64) {
	from := b.fromM + b.pace.Distance
	b.pace.Step(watts, b.gradeAt(from), protocol.ReferenceRiderKg+protocol.BikeKg, protocol.PaceDefaultCdA, 0)
	b.climbed += b.rise(from, b.fromM+b.pace.Distance)
}

// place is where u metres ridden from the road's start, laps unrolled, falls
// on the road in the direction ridden, and the laps behind it. A road that
// does not loop holds at its end.
func (b *bunch) place(u float64) (float64, int) {
	length := b.road.LengthM
	if !b.loop {
		return min(u, length), 0
	}
	lap := math.Floor(u / length)
	return u - lap*length, int(lap)
}

// heightAt is the road's height m metres along it in the direction ridden.
func (b *bunch) heightAt(m float64) float64 {
	if b.reverse {
		m = b.road.LengthM - m
	}
	return b.road.HeightAt(m)
}

// gradeAt is the grade the bunch rides at u: the stored road's, already
// smoothed over 200 m (docs/SPEC.md "Route rides"), and 0 % once a road that
// does not loop has ended.
func (b *bunch) gradeAt(u float64) float64 {
	m, _ := b.place(u)
	if !b.loop && m >= b.road.LengthM {
		return 0
	}
	if b.reverse {
		return -b.road.GradeAt(b.road.LengthM - m)
	}
	return b.road.GradeAt(m)
}

// rise is the metres climbed from u0 to u1, lap by lap so the step from a
// loop's end back to its start is never counted as a climb.
// ponytail: one rise per second; a dip inside one second's metres is lost,
// under a sample's 20 m of road.
func (b *bunch) rise(u0, u1 float64) float64 {
	length := b.road.LengthM
	if !b.loop {
		u0, u1 = min(u0, length), min(u1, length)
	}
	up := 0.0
	for u0 < u1 {
		lapStart := math.Floor(u0/length) * length
		end := min(u1, lapStart+length)
		up += max(0, b.heightAt(end-lapStart)-b.heightAt(u0-lapStart))
		u0 = end
	}
	return up
}

// distance is the road the bunch covered: the metres held at a road's end
// pay nothing.
func (b *bunch) distance() float64 {
	if b.loop {
		return b.pace.Distance
	}
	return min(b.pace.Distance, b.road.LengthM-b.fromM)
}

// rolling is whether a rider carried by the bunch is riding on its road.
func (b *bunch) rolling() bool { return b.pace.Speed > roadRidingMps }

// world is the bunch as the tick carries it, to the centimetre, and each
// rider's place in it to the decimetre. hideOffsets withholds the places
// while a game hides the meter: where a rider stands says how hard they ride.
func (b *bunch) world(hideOffsets bool) *protocol.World {
	m, lap := b.place(b.fromM + b.pace.Distance)
	w := &protocol.World{
		BunchM:   math.Round(m*100) / 100,
		SpeedMps: math.Round(b.pace.Speed*100) / 100,
		Lap:      lap,
	}
	for id, pl := range b.places {
		if pl.resting {
			w.Resting = append(w.Resting, id)
		}
		if !hideOffsets {
			if w.Offsets == nil {
				w.Offsets = make(map[string]int16, len(b.places))
			}
			w.Offsets[id] = int16(math.Round(pl.offset * 10))
		}
	}
	sort.Strings(w.Resting)
	return w
}

// rideBunch advances the session's bunch to now (#3028). The caller has
// already called state(now), so a countdown that ran out is running.
func (s *session) rideBunch(now time.Time) {
	if s.bunch == nil {
		return
	}
	// The countdown's seconds and a pause's are not ridden: the run under
	// way started at startedAt.
	if s.phase == "running" && s.bunch.at.Before(s.startedAt) {
		s.bunch.at = s.startedAt
	}
	// Wall-clock instant of workout second zero, as sprintBlockAt reads it.
	origin := s.startedAt.Add(-s.banked)
	s.bunch.ride(now, s.phase == "running", s.joined, func(at time.Time) planned {
		// The second just ridden is the one that ends at `at`.
		return planAt(workout.SegmentAt(s.segments, int(at.Sub(origin)/time.Second)-1))
	})
}

// world is the bunch on the tick while the session rides it; nil otherwise.
func (s *session) world(hideOffsets bool) *protocol.World {
	if s.bunch == nil || s.phase == "idle" || s.phase == "done" {
		return nil
	}
	return s.bunch.world(hideOffsets)
}

// onRollingRoad is whether the session's riders are being carried along a
// road right now — what makes a coasting rider a riding one.
func (s *session) onRollingRoad() bool {
	return s.bunch != nil && s.phase == "running" && s.bunch.rolling()
}
