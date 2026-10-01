package hub

import (
	"math"
	"reflect"
	"slices"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/road"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// slope is a road of this many metres at one grade, a height every 20 m,
// from 0 m above its start.
func slope(grade, lengthM float64) road.Road {
	heights := make([]float64, int(lengthM/20)+1)
	for i := range heights {
		heights[i] = float64(i) * 20 * grade / 100
	}
	return road.Road{LengthM: lengthM, Heights: heights}
}

func rideOn(profile road.Road, fromM float64, loop, reverse bool) *routeRide {
	return &routeRide{
		SessionRoute: protocol.SessionRoute{ID: "home", Hash: "h-home", FromM: fromM, LengthM: profile.LengthM, Loop: loop, Reverse: reverse},
		profile:      profile,
	}
}

// referencePace is the Go twin stepped by hand: what the bunch must land on.
func referencePace(seconds int, watts func(second int) float64, grade func(m float64) float64) road.Pace {
	var p road.Pace
	for s := range seconds {
		p.Step(watts(s), grade(p.Distance), protocol.ReferenceRiderKg+protocol.BikeKg, protocol.PaceDefaultCdA, 0)
	}
	return p
}

// ADR-0065's table: what the reference rider rides for each kind of block.
func TestTheBunchRidesThePlansPace(t *testing.T) {
	const live = 180.0
	for _, c := range []struct {
		name    string
		seg     workout.Segment
		pct     float64
		inBlock bool
		want    float64
	}{
		{"an ERG block at its prescribed %FTP", workout.Segment{Kind: "steady", Target: 0.75}, 0.75, true, 0.75 * protocol.ReferenceRiderWatts},
		{"a ramp where it stands", workout.Segment{Kind: "ramp", From: 0.5, To: 0.7}, 0.6, true, 0.6 * protocol.ReferenceRiderWatts},
		{"a sprint at 150 %", workout.Segment{Kind: "sprint"}, 0, true, 1.5 * protocol.ReferenceRiderWatts},
		{"an absolute block at its watts", workout.Segment{Kind: "steady", Watts: 300}, 0, true, 300},
		{"a road step at the live mean", workout.Segment{Kind: "road"}, 0, true, live},
		{"a free block at the live mean", workout.Segment{Kind: "freeride"}, 0, true, live},
		{"a game, with no blocks, at the live mean", workout.Segment{}, 0, false, live},
	} {
		if got := planAt(c.seg, c.pct, c.inBlock).watts(live / protocol.ReferenceRiderWatts); got != c.want {
			t.Errorf("%s: %v W, want %v W", c.name, got, c.want)
		}
	}
}

// The live mean takes the pedalling riders at their %FTP, none above 150 %:
// one strong rider cannot tow the bunch away, and nobody pedalling is 0 W.
func TestTheLiveMeanCapsEveryRider(t *testing.T) {
	b := newBunch(rideOn(slope(0, 2200), 0, false, false), time.Unix(0, 0))
	if b.livePct() != 0 {
		t.Fatalf("nobody pedalling rides at %v, want 0", b.livePct())
	}
	b.hear("steady", protocol.RiderMetrics{Watts: 150}, protocol.Rider{FtpWatts: 250})   // 60 %
	b.hear("strong", protocol.RiderMetrics{Watts: 400}, protocol.Rider{FtpWatts: 200})   // 200 %, capped at 150 %
	b.hear("flat-out", protocol.RiderMetrics{Watts: 300}, protocol.Rider{FtpWatts: 200}) // 150 %
	b.hear("no-ftp", protocol.RiderMetrics{Watts: 250}, protocol.Rider{FtpWatts: 0})     // no %FTP to take
	b.hear("stopped", protocol.RiderMetrics{Watts: 250}, protocol.Rider{FtpWatts: 250})
	b.hear("stopped", protocol.RiderMetrics{Watts: 0}, protocol.Rider{FtpWatts: 250}) // then stopped inside the same second
	if want := (0.6 + 1.5 + 1.5) / 3; math.Abs(b.livePct()-want) > 1e-9 {
		t.Fatalf("the live mean rides at %v, want %v", b.livePct(), want)
	}
}

// startedOn is a running session on a road, past its countdown.
func startedOn(t *testing.T, route *routeRide, workoutJSON string, at time.Time) *session {
	t.Helper()
	s := newSession()
	s.begin("ride", "coach", "Coach")
	if !s.pick("Ride", workoutJSON, 3600) {
		t.Fatal("pick refused")
	}
	s.route = route
	if !s.start(at) {
		t.Fatal("start refused")
	}
	return s
}

const ergHalfHour = `{"steps":[{"type":"steady","seconds":1800,"target":0.75}]}`

// An ERG bunch rides the prescription, not the riders (Jan, 2026-09-26): a
// rider far over it moves nobody's road. It advances once per whole second,
// however often the room ticks.
func TestAnErgBunchRidesThePrescriptionOncePerSecond(t *testing.T) {
	start := time.Unix(1_700_000_000, 0)
	s := startedOn(t, rideOn(slope(0, 20000), 0, false, false), ergHalfHour, start)
	now := start.Add(countdownSeconds * time.Second)
	// 4 Hz, the sprint window's burst: still one step a second.
	for range 4 * 120 {
		now = now.Add(time.Second / 4)
		s.state(now)
		s.bunch.hear("strong", protocol.RiderMetrics{Watts: 450}, protocol.Rider{FtpWatts: 200})
		s.rideBunch(now)
	}
	want := referencePace(120, func(int) float64 { return 0.75 * protocol.ReferenceRiderWatts }, func(float64) float64 { return 0 })
	if got := s.bunch.pace; got.Distance != want.Distance || got.Speed != want.Speed {
		t.Fatalf("after 120 s the bunch is at %+v, want the reference rider's %+v", s.bunch.pace, want)
	}
	w := s.world(false)
	if w.BunchM != math.Round(want.Distance*100)/100 || w.SpeedMps != math.Round(want.Speed*100)/100 {
		t.Fatalf("the tick carries %+v, want %.2f m at %.2f m/s", w, want.Distance, want.Speed)
	}
}

// Paused, the bunch stops where it is; resumed, it rolls on from there.
func TestAPausedBunchStops(t *testing.T) {
	start := time.Unix(1_700_000_000, 0)
	s := startedOn(t, rideOn(slope(0, 20000), 0, false, false), ergHalfHour, start)
	now := start.Add(countdownSeconds * time.Second)
	for range 30 {
		now = now.Add(time.Second)
		s.state(now)
		s.rideBunch(now)
	}
	if !s.pause(now) {
		t.Fatal("pause refused")
	}
	held := s.bunch.pace.Distance
	for range 30 {
		now = now.Add(time.Second)
		s.state(now)
		s.rideBunch(now)
	}
	if w := s.world(false); s.bunch.pace.Distance != held || w.SpeedMps != 0 {
		t.Fatalf("paused, the bunch moved to %v m at %v m/s, want held at %v m and stopped", s.bunch.pace.Distance, w.SpeedMps, held)
	}
	s.resume(now)
	now = now.Add(time.Second)
	s.state(now)
	s.rideBunch(now)
	if s.bunch.pace.Distance <= held {
		t.Fatal("resumed, the bunch did not move")
	}
}

// ride runs a session's bunch through whole seconds of its plan.
func ride(s *session, from time.Time, seconds int) time.Time {
	for range seconds {
		from = from.Add(time.Second)
		s.state(from)
		s.rideBunch(from)
	}
	return from
}

// A road that ends holds the bunch at its end, on 0 %: it still rides — the
// plan has not ended — but no metre past the road counts.
func TestTheBunchHoldsAtTheEndOfTheRoad(t *testing.T) {
	start := time.Unix(1_700_000_000, 0)
	s := startedOn(t, rideOn(slope(3, 2200), 2100, false, false), ergHalfHour, start)
	ride(s, start.Add(countdownSeconds*time.Second), 120)
	if w := s.world(false); w.BunchM != 2200 || w.Lap != 0 || !s.bunch.rolling() {
		t.Fatalf("at the end the bunch reads %+v, rolling %v; want held at 2200 m, still riding", w, s.bunch.rolling())
	}
	if s.bunch.distance() != 100 {
		t.Fatalf("the bunch covered %v m, want the 100 m of road left", s.bunch.distance())
	}
	if climbed := s.bunch.climbed; math.Abs(climbed-3) > 1e-6 {
		t.Fatalf("the bunch climbed %v m, want the last 100 m's 3 m", climbed)
	}
}

// A loop adds a lap each time the bunch passes its end, and the drop back to
// the start's height is never a climb.
func TestALoopAddsALap(t *testing.T) {
	start := time.Unix(1_700_000_000, 0)
	// Down 22 m over the lap: riding on, the road "jumps" 22 m back up.
	s := startedOn(t, rideOn(slope(-1, 2200), 2000, true, false), ergHalfHour, start)
	ride(s, start.Add(countdownSeconds*time.Second), 600)
	u := 2000 + s.bunch.pace.Distance
	w := s.world(false)
	if w.Lap != int(u/2200) || w.Lap < 2 || math.Abs(w.BunchM-math.Mod(u, 2200)) > 0.01 {
		t.Fatalf("after %.0f m from 2000 m the bunch reads %+v, want lap %d at %.2f m", s.bunch.pace.Distance, w, int(u/2200), math.Mod(u, 2200))
	}
	if s.bunch.climbed != 0 {
		t.Fatalf("a road that only descends climbed %v m across its laps", s.bunch.climbed)
	}
	if s.bunch.distance() != s.bunch.pace.Distance {
		t.Fatalf("a loop's distance is %v m, want every metre ridden, %v", s.bunch.distance(), s.bunch.pace.Distance)
	}
}

// Reversed, the bunch rides the road from its end: what climbs forward
// descends.
func TestAReversedRoadDescendsWhatClimbs(t *testing.T) {
	start := time.Unix(1_700_000_000, 0)
	forward := startedOn(t, rideOn(slope(5, 20000), 0, false, false), ergHalfHour, start)
	backward := startedOn(t, rideOn(slope(5, 20000), 0, false, true), ergHalfHour, start)
	ride(forward, start.Add(countdownSeconds*time.Second), 300)
	ride(backward, start.Add(countdownSeconds*time.Second), 300)
	if forward.bunch.climbed <= 0 || backward.bunch.climbed != 0 {
		t.Fatalf("forward climbed %v m and reversed %v m, want a climb one way only", forward.bunch.climbed, backward.bunch.climbed)
	}
	if backward.bunch.pace.Distance <= forward.bunch.pace.Distance {
		t.Fatalf("down a 5 %% road the bunch covered %v m, up it %v m", backward.bunch.pace.Distance, forward.bunch.pace.Distance)
	}
}

// The acceptance line (#3028): a ten-minute descent coasted at 0 W never
// marks a rider not-riding — the rule on a road is virtual speed, not watts.
func TestACoastingDescentIsRiding(t *testing.T) {
	coach, ben := as("coach"), as("ben")
	coach.FtpWatts, ben.FtpWatts = 250, 250
	rm, clients := inChannel(t, "velvet", coach, ben)
	now := time.Unix(1_700_000_000, 0)
	rm.now = func() time.Time { return now }
	pick := protocol.Control{Action: "pick", WorkoutName: "Down the valley", WorkoutJSON: `{"steps":[{"type":"road","seconds":900}]}`}
	for _, step := range []struct {
		c     protocol.Control
		route *routeRide
		rider protocol.Rider
	}{
		{pick, rideOn(slope(-6, 20000), 0, false, false), coach},
		{protocol.Control{Action: "join"}, nil, ben},
		{protocol.Control{Action: "start"}, nil, coach},
	} {
		if code, message := rm.controlOn(step.c, step.route, step.rider, now); code != "" {
			t.Fatalf("%s: %s", step.c.Action, message)
		}
	}
	now = now.Add(countdownSeconds * time.Second)
	for second := range 3 + 600 {
		now = now.Add(time.Second)
		// Three strokes over the crest, then nothing.
		watts := 0
		if second < 3 {
			watts = 200
		}
		for _, c := range clients {
			rm.setMetrics(c, protocol.RiderMetrics{Watts: watts, Seq: second + 1})
		}
		rm.mu.Lock()
		out := rm.tickLocked(func() time.Time { return now }, time.Second, false)
		rm.mu.Unlock()
		if !slices.Equal(out.ridingIDs, []string{"ben", "coach"}) {
			t.Fatalf("%d s into the descent riding is %v at %v m/s, want both riders", second, out.ridingIDs, out.tick.World.SpeedMps)
		}
	}
}

// #3028's e2e: two riders on real sockets, the room's clock in the test's
// hands. Both screens are sent the one bunch, and a descent coasted at 0 W
// keeps both riding on the roster long past the 10 s a flat road allows.
func TestTwoRidersShareOneBunchOnTheWire(t *testing.T) {
	h, clock, url := controlHub(t)
	h.SetRoads(fakeRoads{heights: slope(-6, 20000).Heights})
	coach, ben := dial(t, url, "jan:owner"), dial(t, url, "ben:member")
	sendControl(t, coach, protocol.Control{
		Action: "pick", WorkoutName: "Down the valley", TotalSeconds: 900,
		WorkoutJSON: `{"steps":[{"type":"road","seconds":900}]}`,
		Route:       &protocol.ControlRoute{ID: homeLoop},
	})
	awaitFrame(t, ben, "the road picked", routeTick)
	sendControl(t, ben, protocol.Control{Action: "join"})
	awaitFrame(t, coach, "ben in the session", func(msg protocol.ServerMessage) bool {
		return msg.Tick != nil && slices.ContainsFunc(msg.Tick.Roster, func(r protocol.Rider) bool { return r.ID == "ben" && r.InSession })
	})
	clock.Add(int64(controlMinGap))
	sendControl(t, coach, protocol.Control{Action: "start"})
	awaitFrame(t, coach, "the countdown", func(msg protocol.ServerMessage) bool {
		return msg.Tick != nil && msg.Tick.State.Phase == "countdown"
	})
	clock.Add(int64(countdownSeconds * time.Second))

	last := -1.0
	for round := range 4 {
		// Twenty seconds of the room's clock a round: over the crest at
		// 200 W, then nothing.
		clock.Add(int64(20 * time.Second))
		watts := 0
		if round == 0 {
			watts = 200
		}
		for _, conn := range []*websocket.Conn{coach, ben} {
			if err := wsjson.Write(t.Context(), conn, protocol.ClientMessage{Metrics: &protocol.RiderMetrics{Watts: watts, Seq: round + 1}}); err != nil {
				t.Fatal(err)
			}
		}
		at := time.Unix(0, clock.Load()).UnixMilli()
		seen := awaitFrame(t, coach, "both riding on the road", func(msg protocol.ServerMessage) bool {
			if msg.Tick == nil || msg.Tick.At < at || msg.Tick.State.Phase != "running" {
				return false
			}
			jan, _ := ridingOf(msg.Tick.Roster, "jan")
			benRiding, _ := ridingOf(msg.Tick.Roster, "ben")
			return jan && benRiding
		}).Tick
		same := awaitFrame(t, ben, "ben's copy of that tick", func(msg protocol.ServerMessage) bool {
			return msg.Tick != nil && msg.Tick.At == seen.At
		}).Tick
		if !reflect.DeepEqual(same.World, seen.World) || seen.World.BunchM <= last || seen.World.SpeedMps <= roadRidingMps {
			t.Fatalf("round %d: the coach sees %+v and ben %+v, after %v m", round, *seen.World, *same.World, last)
		}
		last = seen.World.BunchM
	}
}

// Off a road nothing changes (#1016): ten seconds without watts is sitting
// down, however fresh the trainer's zeros are.
func TestOffARoadZeroWattsStopsRiding(t *testing.T) {
	coach := as("coach")
	rm, clients := inChannel(t, "velvet", coach)
	now := time.Unix(1_700_000_000, 0)
	rm.now = func() time.Time { return now }
	for _, a := range []string{"pick", "start"} {
		c := protocol.Control{Action: a, WorkoutName: "Flat", WorkoutJSON: ergHalfHour}
		if code, message := rm.controlOn(c, nil, coach, now); code != "" {
			t.Fatalf("%s: %s", a, message)
		}
	}
	now = now.Add(countdownSeconds * time.Second)
	rm.setMetrics(clients["coach"], protocol.RiderMetrics{Watts: 200, Seq: 1})
	for second := range 12 {
		now = now.Add(time.Second)
		rm.setMetrics(clients["coach"], protocol.RiderMetrics{Watts: 0, Seq: second + 2})
	}
	rm.mu.Lock()
	out := rm.tickLocked(func() time.Time { return now }, time.Second, false)
	rm.mu.Unlock()
	if len(out.ridingIDs) != 0 || out.tick.World != nil {
		t.Fatalf("off a road, 12 s at 0 W reads riding %v, world %+v", out.ridingIDs, out.tick.World)
	}
}

// The close tells the keeper how far the bunch rode and what it climbed.
func TestTheCloseCarriesTheRoadRidden(t *testing.T) {
	coach := as("coach")
	rm, _ := inChannel(t, "velvet", coach)
	now := time.Unix(1_700_000_000, 0)
	for _, a := range []string{"pick", "start"} {
		c := protocol.Control{Action: a, WorkoutName: "Up", WorkoutJSON: ergHalfHour}
		route := rideOn(slope(4, 20000), 0, false, false)
		if a != "pick" {
			route = nil
		}
		if code, message := rm.controlOn(c, route, coach, now); code != "" {
			t.Fatalf("%s: %s", a, message)
		}
	}
	now = ride(rm.session, now.Add(countdownSeconds*time.Second), 300)
	rm.session.end(now)
	ev := rm.closedLocked(rm.session.state(now), now)
	if ev.DistanceM != rm.session.bunch.distance() || ev.DistanceM < 1000 || math.Abs(ev.ClimbedM-ev.DistanceM*0.04) > 0.5 {
		t.Fatalf("the close carries %v m and %v m climbed, want the bunch's %v m at 4 %%", ev.DistanceM, ev.ClimbedM, rm.session.bunch.distance())
	}
}

// Well under 1 ms per room per second (#3028's acceptance): one second of a
// bunch with a crew's worth of riders joined and heard, offsets and all.
func BenchmarkABunchSecond(b *testing.B) {
	start := time.Unix(1_700_000_000, 0)
	s := newSession()
	s.begin("ride", "coach", "Coach")
	for r := range 12 {
		s.join(string(rune('a'+r)), true)
	}
	s.pick("Ride", `{"steps":[{"type":"road","seconds":1000000000}]}`, 0)
	s.route = rideOn(slope(4, 200_000), 0, true, false)
	s.start(start)
	now := start.Add(countdownSeconds * time.Second)
	b.ResetTimer()
	for i := range b.N {
		now = now.Add(time.Second)
		s.state(now)
		for r := range 12 {
			s.bunch.hear(string(rune('a'+r)), protocol.RiderMetrics{Watts: 200 + i%50}, protocol.Rider{FtpWatts: 250, WeightKg: 70})
		}
		s.rideBunch(now)
		_ = s.world(false)
	}
}
