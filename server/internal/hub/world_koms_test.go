package hub

import (
	"math"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/road"
)

// stretches is a synthetic road: each stretch so many metres at a grade, a
// height every 20 m.
func stretches(parts ...[2]float64) road.Road {
	heights := []float64{0}
	for _, p := range parts {
		for range int(p[0] / 20) {
			heights = append(heights, heights[len(heights)-1]+20*p[1]/100)
		}
	}
	return road.Road{LengthM: float64(20 * (len(heights) - 1)), Heights: heights}
}

// A 2 km climb at 10 % scores 20,000: class III, the easiest a KOM is held
// on. A 1 km one at 10 % scores 10,000: class IV, and no KOM.
var (
	classIII = [2]float64{2000, 10}
	classIV  = [2]float64{1000, 10}
	flat     = [2]float64{1000, 0}
)

func TestAKomOpensOnClassIIIOrHarderInTheDirectionRidden(t *testing.T) {
	r := stretches(flat, classIV, flat, classIII, flat)
	if got := komOpenings(r, false); len(got) != 1 || got[0] != 5000-komOpensBeforeTopM {
		t.Fatalf("KOMs open at %v, want one only, 300 m before the class III top at 5000 m", got)
	}
	// Ridden from its end, both climbs are descents.
	if got := komOpenings(r, true); len(got) != 0 {
		t.Fatalf("reversed, KOMs open at %v, want none", got)
	}
	// And a road that descends forward climbs reversed.
	down := stretches(flat, [2]float64{2000, -10}, flat)
	if got := komOpenings(down, true); len(got) != 1 || got[0] != 3000-komOpensBeforeTopM {
		t.Fatalf("reversed, a descent's KOM opens at %v, want 300 m before its top at 3000 m", got)
	}
}

// #3102's acceptance: through the room's own tick, on a synthetic road, the
// KOM arms the room's sprint moment, opening as the bunch reaches it.
func TestAKomArmsTheRoomsSprint(t *testing.T) {
	coach, ben := as("coach"), as("ben")
	coach.FtpWatts, ben.FtpWatts, coach.WeightKg, ben.WeightKg = 250, 250, 70, 70
	rm, clients := inChannel(t, "velvet", coach, ben)
	now := time.Unix(1_700_000_000, 0)
	rm.now = func() time.Time { return now }
	for _, step := range []struct {
		c     protocol.Control
		route *routeRide
		rider protocol.Rider
	}{
		{protocol.Control{Action: "pick", WorkoutName: "Up", WorkoutJSON: ergHalfHour}, rideOn(stretches(flat, classIII, flat), 0, false, false), coach},
		{protocol.Control{Action: "join"}, nil, ben},
		{protocol.Control{Action: "start"}, nil, coach},
	} {
		if code, message := rm.controlOn(step.c, step.route, step.rider, now); code != "" {
			t.Fatalf("%s: %s", step.c.Action, message)
		}
	}
	now = now.Add(countdownSeconds * time.Second)
	var (
		armed    *protocol.SprintState
		atOpen   float64
		sprints  int
		lastOpen int64
	)
	for second := range 1800 {
		now = now.Add(time.Second)
		for _, c := range clients {
			rm.setMetrics(c, protocol.RiderMetrics{Watts: 190, Seq: second + 1})
		}
		rm.mu.Lock()
		out := rm.tickLocked(func() time.Time { return now }, time.Second, false)
		rm.mu.Unlock()
		if sp := out.tick.Sprint; sp != nil && sp.StartsAtMs != lastOpen {
			armed, lastOpen = sp, sp.StartsAtMs
			sprints++
		}
		if armed != nil && atOpen == 0 && now.UnixMilli() >= armed.StartsAtMs {
			atOpen = out.tick.World.BunchM
		}
	}
	if sprints != 1 || armed.EndsAtMs-armed.StartsAtMs != sprintWindow.Milliseconds() {
		t.Fatalf("the road armed %d sprints, the last %+v; want one, of the 15 s window", sprints, armed)
	}
	// The window opens where the bunch reaches the KOM, to within the one
	// second between two ticks.
	if opening := 3000.0 - komOpensBeforeTopM; math.Abs(atOpen-opening) > 5 {
		t.Fatalf("the window opened with the bunch at %v m, want at the KOM's %v m", atOpen, opening)
	}
}

// The spacing limits hold: at most one KOM every five minutes, and six in a
// ride, however many the road offers — the rest are let go, not saved up.
func TestKomsAreSpacedAndCounted(t *testing.T) {
	coach := as("coach")
	rm, _ := inChannel(t, "velvet", coach)
	now := time.Unix(1_700_000_000, 0)
	for _, a := range []string{"pick", "start"} {
		var route *routeRide
		if a == "pick" {
			route = rideOn(slope(0, 200_000), 0, false, false)
		}
		if code, message := rm.controlOn(protocol.Control{Action: a, WorkoutName: "Flat", WorkoutJSON: `{"steps":[{"type":"steady","seconds":7200,"target":0.75}]}`}, route, coach, now); code != "" {
			t.Fatalf("%s: %s", a, message)
		}
	}
	// A KOM every kilometre: one every couple of minutes at this pace.
	b := rm.session.bunch
	b.koms = nil
	for m := 1000.0; m < 200_000; m += 1000 {
		b.koms = append(b.koms, m)
	}
	b.komU, b.komLeft = b.komAt(0, false)
	now = now.Add(countdownSeconds * time.Second)
	var opens []time.Time
	for range 7200 {
		now = now.Add(time.Second)
		rm.session.state(now)
		rm.session.rideBunch(now)
		rm.armKomLocked(now)
		if sp := rm.sprint; sp != nil && (len(opens) == 0 || !sp.startsAt.Equal(opens[len(opens)-1])) {
			opens = append(opens, sp.startsAt)
		}
	}
	if len(opens) != maxKomsPerRide {
		t.Fatalf("two hours past a KOM every kilometre armed %d sprints, want %d", len(opens), maxKomsPerRide)
	}
	for i := 1; i < len(opens); i++ {
		if gap := opens[i].Sub(opens[i-1]); gap < komSpacing {
			t.Fatalf("KOMs %d and %d open %v apart, want at least %v", i-1, i, gap, komSpacing)
		}
	}
}

// A loop holds its KOM again on every lap.
func TestALoopsKomComesRoundAgain(t *testing.T) {
	b := newBunch(rideOn(stretches(flat, classIII, flat), 0, true, false), time.Unix(0, 0))
	first, ok := b.komAt(0, false)
	second, again := b.komAt(first, true)
	if !ok || !again || first != 2700 || second != 2700+b.road.LengthM {
		t.Fatalf("the loop's KOMs open at %v (%v) and %v (%v), want 2700 m and a lap later", first, ok, second, again)
	}
}
