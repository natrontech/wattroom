package hub

import (
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/road"
)

// hills is two 2 km climbs at 6 %, starting at 1000 m and 4500 m, with flat
// road around them, a height every 20 m.
func hills() road.Road {
	var heights []float64
	h := 0.0
	for _, leg := range [][2]float64{{1000, 0}, {2000, 6}, {1500, 0}, {2000, 6}, {3000, 0}} {
		for range int(leg[0] / 20) {
			heights = append(heights, h)
			h += 20 * leg[1] / 100
		}
	}
	return road.Road{LengthM: float64(len(heights)) * 20, Heights: append(heights, h)}
}

func paint(stamp protocol.RoadsideStamp, atM float64) protocol.Roadside {
	return protocol.Roadside{Kind: protocol.RoadsideKindPaint, Stamp: stamp, AtM: atM}
}

// #3029's paint matrix, docs/SPEC.md "The roadside": a closed set of chalk,
// on a climb, ahead of the riders, and an initial only for a rider riding.
// The bunch starts on the first climb, so it has climb behind it too.
func TestTheRoadsidePaintsAClimbAheadInChalk(t *testing.T) {
	initial := func(forRider string, atM float64) protocol.Roadside {
		v := paint(protocol.RoadsideStampInitial, atM)
		v.For = forRider
		return v
	}
	for _, c := range []struct {
		name  string
		rider string
		verb  func(bunch float64) protocol.Roadside
		code  string
		says  string
	}{
		{"a heart up the climb", "ben", func(b float64) protocol.Roadside { return paint(protocol.RoadsideStampHeart, b+500) }, "", ""},
		{"Allez on the next climb", "ben", func(float64) protocol.Roadside { return paint(protocol.RoadsideStampAllez, 5000) }, "", ""},
		{"the coach's initial", "ben", func(b float64) protocol.Roadside { return initial("coach", b+500) }, "", ""},
		{"on the climb behind the bunch", "ben", func(b float64) protocol.Roadside { return paint(protocol.RoadsideStampHeart, b-100) }, "validation_error", "behind the bunch"},
		{"on the flat between", "ben", func(float64) protocol.Roadside { return paint(protocol.RoadsideStampHopp, 3800) }, "validation_error", "on a climb"},
		{"a stamp that is not chalk", "ben", func(b float64) protocol.Roadside { return paint("skull", b+500) }, "validation_error", "chalk stamps"},
		{"no stamp at all", "ben", func(b float64) protocol.Roadside { return paint("", b+500) }, "validation_error", "chalk stamps"},
		{"an initial for nobody", "ben", func(b float64) protocol.Roadside { return initial("", b+500) }, "validation_error", "an initial always does"},
		{"a heart that names a rider", "ben", func(b float64) protocol.Roadside {
			v := paint(protocol.RoadsideStampHeart, b+500)
			v.For = "coach"
			return v
		}, "validation_error", "Only an initial names"},
		{"an initial for someone not riding", "ben", func(b float64) protocol.Roadside { return initial("ben", b+500) }, "validation_error", "riding this session"},
		{"off the road's end", "ben", func(float64) protocol.Roadside { return paint(protocol.RoadsideStampHeart, 9501) }, "validation_error", "not a place on this road"},
		{"a rider riding the session", "coach", func(b float64) protocol.Roadside { return paint(protocol.RoadsideStampHeart, b+500) }, "forbidden", "riding this session"},
	} {
		t.Run(c.name, func(t *testing.T) {
			rm, _, now := onTheRoad(t, rideOn(hills(), 1000, false, false))
			code, message := rm.roadsideVerb(c.rider, c.verb(bunchAt(rm)), now)
			if code != c.code || !strings.Contains(message, c.says) {
				t.Fatalf("answered %q %q, want %q saying %q", code, message, c.code, c.says)
			}
			st := standing(rm)
			if (c.code == "") != (len(st.Paint) == 1) {
				t.Fatalf("the roadside reads %+v after a %q answer", st, code)
			}
			if c.code == "" && (st.Paint[0].RiderID != c.rider || st.Paint[0].Stamp != c.verb(0).Stamp) {
				t.Fatalf("the chalk reads %+v", st.Paint[0])
			}
		})
	}
}

// Chalk stays where it was painted until the last rider rides over it, and
// the revision says when it goes.
func TestChalkGoesOnceTheBunchRidesOverIt(t *testing.T) {
	rm, _, now := onTheRoad(t, rideOn(hills(), 1000, false, false))
	at := bunchAt(rm) + 60
	if code, message := rm.roadsideVerb("ben", paint(protocol.RoadsideStampArrow, at), now); code != "" {
		t.Fatal(message)
	}
	painted := standing(rm).Rev
	for bunchAt(rm) <= at {
		now = tickFor(rm, now, 1)
		if bunchAt(rm) <= at && len(standing(rm).Paint) != 1 {
			t.Fatal("the chalk went before the bunch reached it")
		}
	}
	if st := standing(rm); len(st.Paint) != 0 || st.Rev <= painted {
		t.Fatalf("after the bunch rode over it the roadside reads %+v (painted at rev %d)", st, painted)
	}
}

// The budgets, docs/SPEC.md "The roadside": one stamp per climb and six a
// ride for each spectator, twelve on the road at once, twenty-four a ride.
func TestPaintKeepsToItsBudgets(t *testing.T) {
	heart := paint(protocol.RoadsideStampHeart, 0)
	chalk := func(rs *roadsideStands, who string, climb float64) string {
		code, _ := rs.chalkUp(who, heart, climb+10, 0, climb, "the bunch")
		return code
	}
	var rs roadsideStands
	if code := chalk(&rs, "ben", 1000); code != "" {
		t.Fatalf("the first stamp: %q", code)
	}
	if code := chalk(&rs, "ben", 1000); code != "conflict" {
		t.Fatalf("a second stamp on the same climb: %q, want conflict", code)
	}
	if code := chalk(&rs, "cy", 1000); code != "" {
		t.Fatalf("another spectator on the same climb: %q", code)
	}
	for climb := 2000.0; climb < 7000; climb += 1000 {
		if code := chalk(&rs, "ben", climb); code != "" {
			t.Fatalf("ben's stamp on the climb at %.0f: %q", climb, code)
		}
	}
	if code := chalk(&rs, "ben", 9000); code != "rate_limited" {
		t.Fatalf("ben's seventh stamp: %q, want rate_limited", code)
	}
	for climb := 2000.0; len(rs.paint) < protocol.RoadsidePaintLive; climb += 1000 {
		if code := chalk(&rs, "cy", climb); code != "" {
			t.Fatalf("cy's stamp on the climb at %.0f: %q", climb, code)
		}
	}
	if code := chalk(&rs, "dee", 1000); code != "rate_limited" {
		t.Fatalf("a thirteenth stamp on the road: %q, want rate_limited", code)
	}
	// Ridden over, the road has room again; the ride's own budget does not.
	rs.settle(1e9, map[string]struct{}{}, func(string) bool { return false })
	rs.marks = protocol.RoadsideMarksPerRide
	if code := chalk(&rs, "dee", 1000); code != "rate_limited" {
		t.Fatalf("a stamp past the ride's %d marks: %q, want rate_limited", protocol.RoadsideMarksPerRide, code)
	}
}

// A race's roadside paints its climbs ahead of the leader, by the same rules.
func TestARaceRoadsidePaintsOnlyAClimb(t *testing.T) {
	r := raceOn(t, 3000, racer("ana", 70), racer("ben", 70))
	r.rm.join(&client{rider: racer("cy", 70), out: make(chan []byte, clientQueue)})
	pedal := watts(map[string]int{"ana": 300, "ben": 120})
	lead := r.ride(10+protocol.RaceNeutralSeconds+20, pedal).World.Racers["ana"].M
	if code, message := r.rm.roadsideVerb("cy", paint(protocol.RoadsideStampHopp, lead+500), r.now); code != "validation_error" || !strings.Contains(message, "on a climb") {
		t.Fatalf("paint on a flat race road answered %q %q", code, message)
	}
}
