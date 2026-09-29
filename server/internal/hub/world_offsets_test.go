package hub

import (
	"math"
	"slices"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// bunchRider is one rider in these tests: what they send each second, if
// anything.
type bunchRider struct {
	id   string
	ftp  int
	kg   int
	send func(second int) (watts int, bias float64, heard bool)
}

func steadily(watts int, bias float64) func(int) (int, float64, bool) {
	return func(int) (int, float64, bool) { return watts, bias, true }
}

// rideBunch rides a bunch on this road for so many seconds of one plan, the
// riders all joined, and returns it with the clock where it stopped.
func rideBunch(profile routeRide, p planned, seconds int, riders ...bunchRider) *bunch {
	at := time.Unix(1_700_000_000, 0)
	b := newBunch(&profile, at)
	joined := map[string]struct{}{}
	for _, r := range riders {
		joined[r.id] = struct{}{}
	}
	for second := range seconds {
		for _, r := range riders {
			if watts, bias, heard := r.send(second); heard {
				b.hear(r.id, protocol.RiderMetrics{Watts: watts, Bias: bias}, protocol.Rider{ID: r.id, FtpWatts: r.ftp, WeightKg: r.kg})
			}
		}
		at = at.Add(time.Second)
		b.ride(at, true, joined, func(time.Time) planned { return p })
	}
	return b
}

func offsetOf(b *bunch, id string) float64 { return b.places[id].offset }

var flatRoad = *rideOn(slope(0, 200_000), 0, false, false)

// #3097's acceptance, one table row each where a row says it.
func TestAnOffsetFollowsTheRidersSurplus(t *testing.T) {
	erg := planned{pct: 0.75}
	for _, c := range []struct {
		name    string
		road    routeRide
		plan    planned
		seconds int
		riders  []bunchRider
		check   func(t *testing.T, b *bunch)
	}{
		{
			// A trim is the rider's own plan (#795): riding 90 % of the
			// target at a 0.9 bias is riding the plan, and costs no place.
			name: "an unpunished trim", road: flatRoad, plan: erg, seconds: 300,
			riders: []bunchRider{
				{id: "trimmed", ftp: 200, send: steadily(135, 0.9)},
				{id: "on-target", ftp: 200, send: steadily(150, 0)},
				{id: "under", ftp: 200, send: steadily(135, 0)},
			},
			check: func(t *testing.T, b *bunch) {
				if o := offsetOf(b, "trimmed"); math.Abs(o) > 0.01 {
					t.Errorf("a rider on their own trim sits at %v m, want 0", o)
				}
				if o := offsetOf(b, "on-target"); math.Abs(o) > 0.01 {
					t.Errorf("a rider on target sits at %v m, want 0", o)
				}
				if o := offsetOf(b, "under"); o >= -1 {
					t.Errorf("a rider 10 %% under with no trim sits at %v m, want drifting back", o)
				}
			},
		},
		{
			// W/kg against the mean, not %FTP: two riders at the same
			// 175 % of their own FTPs, and the lighter-for-their-watts one
			// goes up the road.
			name: "a sprint surge", road: flatRoad, plan: planned{sprint: true}, seconds: 2,
			riders: []bunchRider{
				{id: "light", ftp: 400, kg: 70, send: steadily(700, 0)},
				{id: "heavy", ftp: 200, kg: 70, send: steadily(350, 0)},
				{id: "also", ftp: 200, kg: 70, send: steadily(350, 0)},
			},
			check: func(t *testing.T, b *bunch) {
				light, heavy, also := offsetOf(b, "light"), offsetOf(b, "heavy"), offsetOf(b, "also")
				if light <= 1 || heavy >= 0 || heavy != also {
					t.Errorf("after 2 s of sprint: 10 W/kg at %v m, 5 W/kg at %v and %v m; want the 10 up the road, the 5s level behind", light, heavy, also)
				}
			},
		},
		{
			name: "the clamp", road: flatRoad, plan: erg, seconds: 300,
			riders: []bunchRider{
				{id: "flying", ftp: 200, send: steadily(400, 0)},
				{id: "crawling", ftp: 200, send: steadily(20, 0)},
			},
			check: func(t *testing.T, b *bunch) {
				if up, down := offsetOf(b, "flying"), offsetOf(b, "crawling"); up != offsetMaxM || down != offsetMinM {
					t.Errorf("clamped at %v and %v m, want %v and %v", up, down, offsetMaxM, offsetMinM)
				}
			},
		},
		{
			// Coasting is riding (#3028): a trainer still talking at 0 W is
			// in the bunch — at its tail under an ERG block, and exactly
			// where they were on a road step nobody pedals.
			name: "a coasting descent", road: *rideOn(slope(-6, 20_000), 0, false, false), plan: erg, seconds: 600,
			riders: []bunchRider{{id: "coasting", ftp: 200, send: steadily(0, 0)}},
			check: func(t *testing.T, b *bunch) {
				if pl := b.places["coasting"]; pl.resting || pl.offset != offsetMinM {
					t.Errorf("after 10 min coasting down: at %v m, resting %v; want at the tail, riding", pl.offset, pl.resting)
				}
			},
		},
		{
			name: "a coasting descent on a road step", road: *rideOn(slope(-6, 20_000), 0, false, false), plan: planned{}, seconds: 600,
			riders: []bunchRider{
				{id: "a", ftp: 200, send: steadily(0, 0)},
				{id: "b", ftp: 250, send: steadily(0, 0)},
			},
			check: func(t *testing.T, b *bunch) {
				for _, id := range []string{"a", "b"} {
					if pl := b.places[id]; pl.resting || pl.offset != 0 {
						t.Errorf("%s after 10 min coasting a road step: at %v m, resting %v; want 0, riding", id, pl.offset, pl.resting)
					}
				}
			},
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			c.check(t, rideBunch(c.road, c.plan, c.seconds, c.riders...))
		})
	}
}

// Rest and tow: a rider silent past 10 s coasts back toward −40 m and is
// marked Resting; heard again, the team car tows them in over 20 s. Nobody
// is ever removed.
func TestASilentRiderRestsAndIsTowedBack(t *testing.T) {
	// On the plan for a minute, silent for a minute, then back on it.
	back := func(second int) (int, float64, bool) { return 150, 0, second < 60 || second >= 120 }
	at := func(seconds int) *bunch {
		return rideBunch(flatRoad, planned{pct: 0.75}, seconds, bunchRider{id: "away", ftp: 200, send: back}, bunchRider{id: "here", ftp: 200, send: steadily(150, 0)})
	}
	if b := at(70); b.places["away"].resting || slices.Contains(b.world(false).Resting, "away") {
		t.Fatal("ten seconds silent is not yet resting")
	}
	rested := at(120)
	pl := rested.places["away"]
	if want := restingOffsetM + (0-restingOffsetM)*math.Exp(-50/offsetTauSeconds); !pl.resting || math.Abs(pl.offset-want) > 0.01 {
		t.Fatalf("a minute silent: at %v m, resting %v; want coasting back to %v m", pl.offset, pl.resting, want)
	}
	if w := rested.world(false); !slices.Equal(w.Resting, []string{"away"}) || w.Offsets["away"] != int16(math.Round(pl.offset*10)) {
		t.Fatalf("the tick carries resting %v and %d dm, want away resting at %.1f m", w.Resting, w.Offsets["away"], pl.offset)
	}
	halfway := at(131).places["away"]
	if halfway.resting || math.Abs(halfway.offset-pl.offset/2) > 1 {
		t.Fatalf("ten seconds into the tow: at %v m, resting %v; want halfway in from %v m", halfway.offset, halfway.resting, pl.offset)
	}
	if towed := at(150).places["away"]; math.Abs(towed.offset) > 0.5 {
		t.Fatalf("after the tow and ten seconds on the plan: at %v m, want back in the bunch", towed.offset)
	}
}

// While Watt Golf hides the meter, where a rider stands would say how hard
// they ride: the tick carries the bunch and who is resting, and no offsets.
func TestWattGolfWithholdsTheOffsets(t *testing.T) {
	coach, ben := as("coach"), as("ben")
	coach.FtpWatts, ben.FtpWatts = 250, 250
	rm, clients := inChannel(t, "velvet", coach, ben)
	now := time.Unix(1_700_000_000, 0)
	rm.now = func() time.Time { return now }
	if refusal := rm.startGameOn("watt-golf", rideOn(slope(0, 20_000), 0, false, false), coach, now); refusal != "" {
		t.Fatal(refusal)
	}
	if code, message := rm.controlOn(protocol.Control{Action: "join"}, nil, ben, now); code != "" {
		t.Fatal(message)
	}
	var out tickOut
	for second := range 5 {
		now = now.Add(time.Second)
		for _, c := range clients {
			rm.setMetrics(c, protocol.RiderMetrics{Watts: 200, Seq: second + 1})
		}
		rm.mu.Lock()
		out = rm.tickLocked(func() time.Time { return now }, time.Second, false)
		rm.mu.Unlock()
	}
	if out.tick.Game == nil || !out.tick.Game.MeterHidden {
		t.Fatalf("the golf tee should hide the meter: %+v", out.tick.Game)
	}
	if w := out.tick.World; w == nil || w.Offsets != nil || w.BunchM <= 0 {
		t.Fatalf("with the meter hidden the tick carries %+v, want the bunch moving and no offsets", w)
	}
}
