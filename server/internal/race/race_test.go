package race

import (
	"errors"
	"math"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/road"
)

var flag = time.Unix(1_700_000_000, 0)

// flat is a road of this many metres at 0 %, a height every 20 m.
func flat(lengthM float64) road.Road {
	return road.Road{LengthM: lengthM, Heights: make([]float64, int(lengthM/20)+1)}
}

// ride starts a race on profile and rides it for so many seconds after the
// klaxon, each second's watts from power.
func ride(t *testing.T, profile road.Road, entrants []Entrant, seconds int, power func(id string, second int) (int, bool)) *Race {
	t.Helper()
	r, err := New(profile, entrants, flag)
	if err != nil {
		t.Fatal(err)
	}
	klaxon := flag.Add(protocol.RaceNeutralSeconds * time.Second)
	for s := 1; s <= seconds; s++ {
		watts := map[string]int{}
		for _, e := range entrants {
			if w, heard := power(e.ID, s); heard {
				watts[e.ID] = w
			}
		}
		r.Step(klaxon.Add(time.Duration(s)*time.Second), watts)
	}
	return r
}

func steady(w map[string]int) func(string, int) (int, bool) {
	return func(id string, _ int) (int, bool) { v, ok := w[id]; return v, ok }
}

// ADR-0067: each rider rides the reference rider at their W/kg × 75 kg, so
// weight neither buys speed on the flat nor costs it on a climb.
func TestWeightNeverBuysSpeed(t *testing.T) {
	for _, grade := range []float64{0, 6} {
		climb := road.Road{LengthM: 20_000, Heights: make([]float64, 1001)}
		for i := range climb.Heights {
			climb.Heights[i] = float64(i) * 20 * grade / 100
		}
		// The second rider sits out, so nobody shelters anybody.
		light := ride(t, climb, []Entrant{{ID: "a", WeightKg: 60, Category: "B"}, {ID: "idle", WeightKg: 75, Category: "D"}}, 120, steady(map[string]int{"a": 240}))
		heavy := ride(t, climb, []Entrant{{ID: "a", WeightKg: 90, Category: "B"}, {ID: "idle", WeightKg: 75, Category: "D"}}, 120, steady(map[string]int{"a": 360}))
		if l, h := light.Racers()["a"].M, heavy.Racers()["a"].M; l != h {
			t.Errorf("at %.0f %%: 4 W/kg at 60 kg rode %.2f m, at 90 kg %.2f m", grade, l, h)
		}
	}
}

// The field is open (ADR-0077): a wheel ahead shelters the rider behind it,
// so two riders together beat one alone at the same W/kg.
func TestAWheelAheadShelters(t *testing.T) {
	pair := ride(t, flat(20_000), []Entrant{{ID: "a", WeightKg: 75, Category: "C"}, {ID: "b", WeightKg: 75, Category: "C"}}, 180, steady(map[string]int{"a": 250, "b": 250}))
	alone := ride(t, flat(20_000), []Entrant{{ID: "a", WeightKg: 75, Category: "C"}, {ID: "idle", WeightKg: 75, Category: "C"}}, 180, steady(map[string]int{"a": 250}))
	solo := alone.Racers()["a"].M
	for _, id := range []string{"a", "b"} {
		if m := pair.Racers()[id].M; m <= solo {
			t.Errorf("%s together rode %.1f m, alone %.1f m: nobody sheltered", id, m, solo)
		}
	}
}

// The neutral zone moves nobody: every racer leaves km 0 at the klaxon.
func TestTheNeutralZoneStartsEveryoneAtKmZero(t *testing.T) {
	r, err := New(flat(1000), []Entrant{{ID: "a", WeightKg: 75}, {ID: "b", WeightKg: 75}}, flag)
	if err != nil {
		t.Fatal(err)
	}
	for s := 1; s < protocol.RaceNeutralSeconds; s++ {
		r.Step(flag.Add(time.Duration(s)*time.Second), map[string]int{"a": 400, "b": 100})
	}
	for id, rr := range r.Racers() {
		if rr.M != 0 {
			t.Errorf("%s is %.1f m up the road before the klaxon", id, rr.M)
		}
	}
}

// The photo finish (#3032): a crossing is placed inside the second it
// happened in — not on the tick that noticed it — so two riders over the
// line in one tick still come out in order. A lone racer, so no draft moves
// the line.
func TestThePhotoFinishIsInsideTheSecond(t *testing.T) {
	r, err := New(flat(200), []Entrant{{ID: "a", WeightKg: 75, Category: "C"}, {ID: "idle", WeightKg: 75, Category: "C"}}, flag)
	if err != nil {
		t.Fatal(err)
	}
	klaxon := flag.Add(protocol.RaceNeutralSeconds * time.Second)
	for s := 1; s <= 60; s++ {
		at := klaxon.Add(time.Duration(s) * time.Second)
		r.Step(at, map[string]int{"a": 300})
		after := r.Racers()["a"]
		if after.FinishMs == 0 {
			continue
		}
		start := at.Add(-time.Second).UnixMilli()
		if after.FinishMs <= start || after.FinishMs > at.UnixMilli() || after.FinishMs%1000 == 0 {
			t.Fatalf("crossed in the second ending %d and was timed %d: not inside it", at.UnixMilli(), after.FinishMs)
		}
		return
	}
	t.Fatal("never crossed a 200 m line at 300 W in a minute")
}

// Disconnect grace (docs/SPEC.md "Races"): a rider silent for 30 s is out.
func TestASilentRiderIsOutAfterTheGrace(t *testing.T) {
	quiet := func(id string, second int) (int, bool) {
		if id == "gone" && second > 5 {
			return 0, false
		}
		return 250, true
	}
	r := ride(t, flat(50_000), []Entrant{{ID: "here", WeightKg: 75}, {ID: "gone", WeightKg: 75}}, 5+protocol.RaceDisconnectSeconds, quiet)
	if r.racers["gone"].out {
		t.Fatal("out at exactly the grace")
	}
	r.Step(flag.Add((protocol.RaceNeutralSeconds+6+protocol.RaceDisconnectSeconds)*time.Second), map[string]int{"here": 250})
	if !r.racers["gone"].out {
		t.Fatal("silent past the grace and still racing")
	}
}

func TestARaceNeedsTwoRiders(t *testing.T) {
	if _, err := New(flat(1000), []Entrant{{ID: "a", WeightKg: 75}}, flag); !errors.Is(err, ErrTooFew) {
		t.Fatalf("one rider: err = %v, want ErrTooFew", err)
	}
}

// Results per Category D–A on the closing card (ADR-0067): each Category's
// finishers in order, the unranked apart and told why, and a Category of one
// rider rode alone.
func TestResultsArePerCategoryWithTheUnrankedApart(t *testing.T) {
	entrants := []Entrant{
		{ID: "c-first", WeightKg: 75, Category: "C"},
		{ID: "c-second", WeightKg: 75, Category: "C"},
		{ID: "c-fresh", WeightKg: 75, Category: "C", Unranked: protocol.UnrankedFreshWeight},
		{ID: "b-alone", WeightKg: 75, Category: "B"},
		{ID: "d-dnf", WeightKg: 75, Category: "D"},
	}
	power := map[string]int{"c-first": 330, "c-second": 300, "c-fresh": 400, "b-alone": 280}
	r := ride(t, flat(1000), entrants, 400, steady(power))
	if !r.Done() {
		t.Fatal("every racer is over the line or out, and the race is not done")
	}
	got := r.Results()
	if len(got) != 2 || got[0].Category != "C" || got[1].Category != "B" {
		t.Fatalf("results %+v, want C then B (D–A), and no bracket for D's lone non-finisher", got)
	}
	c := got[0]
	if len(c.Placed) != 2 || c.Placed[0].ID != "c-first" || c.Placed[1].ID != "c-second" || c.Alone {
		t.Errorf("C placed %+v (alone %v), want c-first then c-second", c.Placed, c.Alone)
	}
	if len(c.Unranked) != 1 || c.Unranked[0].ID != "c-fresh" || c.Unranked[0].Why != protocol.UnrankedFreshWeight {
		t.Errorf("C unranked %+v, want c-fresh, told fresh_weight — first over the line, placed nowhere", c.Unranked)
	}
	if b := got[1]; !b.Alone || len(b.Placed) != 1 {
		t.Errorf("B %+v: a Category of one rides alone", b)
	}
}

// A neutralised span moves nobody and puts nobody out (#3658): a rider silent
// through a hold longer than the grace is still racing after it, and a hold
// inside the neutral zone moves the klaxon by as much.
func TestANeutralisedSpanIsTakenOutOfTheRace(t *testing.T) {
	r, err := New(flat(5_000), []Entrant{{ID: "a", WeightKg: 75, Category: "C"}, {ID: "b", WeightKg: 75, Category: "C"}}, flag)
	if err != nil {
		t.Fatal(err)
	}
	klaxon := r.Klaxon()
	r.Neutralised(flag.Add(time.Minute), flag.Add(2*time.Minute))
	if want := klaxon.Add(time.Minute); !r.Klaxon().Equal(want) {
		t.Fatalf("klaxon after a minute's hold in the neutral zone: %v, want %v", r.Klaxon(), want)
	}
	start := r.Klaxon()
	r.Step(start.Add(time.Second), map[string]int{"a": 250, "b": 250})
	from, to := start.Add(time.Second), start.Add(time.Second+2*protocol.RaceDisconnectSeconds*time.Second)
	r.Neutralised(from, to)
	r.Step(to.Add(time.Second), map[string]int{"a": 250, "b": 250})
	if r.Done() || r.Racers()["b"].M == 0 {
		t.Fatalf("after a hold longer than the grace: done %v, b at %.1f m", r.Done(), r.Racers()["b"].M)
	}
	if eta, ok := r.LeaderETA(); !ok || eta <= 0 {
		t.Fatalf("leader ETA: %v %v", eta, ok)
	}
}

// A hold after the klaxon never counts against a time (#3658): the same
// race ridden with a minute neutralised halfway finishes on the same clock.
func TestAHoldIsNotInAnyonesTime(t *testing.T) {
	finish := func(hold bool) int64 {
		r, err := New(flat(1_000), []Entrant{{ID: "a", WeightKg: 75, Category: "C"}, {ID: "b", WeightKg: 75, Category: "C"}}, flag)
		if err != nil {
			t.Fatal(err)
		}
		at := r.Klaxon()
		for s := 1; s <= 200 && !r.Done(); s++ {
			at = at.Add(time.Second)
			if hold && s == 30 {
				r.Neutralised(at.Add(-time.Second), at.Add(time.Minute-time.Second))
				at = at.Add(time.Minute - time.Second)
				continue
			}
			r.Step(at, map[string]int{"a": 250, "b": 200})
		}
		return r.Racers()["a"].FinishMs - r.Klaxon().UnixMilli()
	}
	if plain, held := finish(false), finish(true); plain != held {
		t.Fatalf("a's time: %d ms plain, %d ms with a minute held", plain, held)
	}
}

// A rider who comes after the flag (#3175): before the klaxon onto the grid
// with everyone, after it from km 0 — and never ranked, whatever they ride.
func TestALateJoinerAfterKmZeroIsNeverRanked(t *testing.T) {
	r, err := New(flat(800), []Entrant{{ID: "a", WeightKg: 75, Category: "C"}, {ID: "b", WeightKg: 75, Category: "C"}}, flag)
	if err != nil {
		t.Fatal(err)
	}
	if !r.Join(Entrant{ID: "grid", WeightKg: 75, Category: "C"}, flag.Add(time.Minute)) {
		t.Fatal("a join in the neutral zone was refused")
	}
	at := r.Klaxon()
	for s := 1; s <= 30; s++ {
		at = at.Add(time.Second)
		r.Step(at, map[string]int{"a": 150, "b": 150, "grid": 150})
	}
	if !r.Join(Entrant{ID: "late", WeightKg: 75, Category: "C"}, at) || r.Join(Entrant{ID: "a"}, at) {
		t.Fatal("a join after km 0, or a second one for a racer, went the wrong way")
	}
	for s := 1; s <= 400 && !r.Done(); s++ {
		at = at.Add(time.Second)
		// The late rider is the strongest by far, and still placed nowhere.
		r.Step(at, map[string]int{"a": 150, "b": 150, "grid": 150, "late": 600})
	}
	res := r.Results()
	if len(res) != 1 || len(res[0].Placed) != 3 || len(res[0].Unranked) != 1 ||
		res[0].Unranked[0].ID != "late" || res[0].Unranked[0].Why != protocol.UnrankedLate {
		t.Fatalf("results: %+v", res)
	}
}

// A clock race (#3171): nobody moves past its end, and a hold before the end
// moves the end on by as long as it held.
func TestAClockRaceRunsOutAndAHoldMovesItsEnd(t *testing.T) {
	r, err := New(flat(100_000), []Entrant{{ID: "a", WeightKg: 75, Category: "C"}, {ID: "b", WeightKg: 75, Category: "C"}}, flag)
	if err != nil {
		t.Fatal(err)
	}
	end := r.Klaxon().Add(10 * time.Minute)
	r.Clock(end)
	at := r.Klaxon().Add(5 * time.Minute)
	r.Neutralised(at, at.Add(time.Minute))
	if want := end.Add(time.Minute); !r.Ends().Equal(want) {
		t.Fatalf("the clock ends at %v after a minute's hold, want %v", r.Ends(), want)
	}
	for at := r.Klaxon().Add(time.Second); !r.Done(); at = at.Add(time.Second) {
		r.Step(at, map[string]int{"a": 250, "b": 250})
		if at.After(r.Ends().Add(2 * time.Second)) {
			t.Fatal("the clock ran out and the race went on")
		}
	}
	m := r.Racers()["a"].M
	r.Step(r.Ends().Add(10*time.Second), map[string]int{"a": 250, "b": 250})
	if r.Racers()["a"].M != m {
		t.Error("a racer moved past the clock's end")
	}
}

// A Wheelrace's handicap (#3172): the line goes where the scratch rider gets
// in par, on a height step; the scratch starts at km 0, a weaker rider up the
// road, a much weaker one farther up; and the pace model brings each to the
// line at par. A road shorter than par puts the line at its end.
func TestAHandicapBringsEveryoneToTheLineAtPar(t *testing.T) {
	rolling := road.Road{LengthM: 40_000, Heights: make([]float64, 2001)}
	for i := range rolling.Heights {
		rolling.Heights[i] = 30 * math.Sin(float64(i)/40)
	}
	par := 30 * time.Minute
	h := NewHandicap(rolling, par, 300)
	if h.LineM <= 10_000 || h.LineM >= rolling.LengthM || math.Mod(h.LineM, rolling.Step()) != 0 {
		t.Fatalf("the line at %.0f m", h.LineM)
	}
	if s := h.Start(300); s != 0 {
		t.Errorf("the scratch rider starts at %.1f m", s)
	}
	// The line sits on a height step at or short of par's distance, so the
	// scratch rider's own time to it is par or a breath under, and that is
	// the time every head start is set to ride.
	scratch := timeAlong(rolling, 0, h.LineM, 300)
	if scratch > par.Seconds() || scratch < par.Seconds()-5 {
		t.Fatalf("the scratch rider reaches the line in %.1f s, want par %.0f s", scratch, par.Seconds())
	}
	for _, w := range []float64{250, 180} {
		s := h.Start(w)
		if s <= 0 || s >= h.LineM {
			t.Fatalf("%v W starts at %.1f m", w, s)
		}
		if got := timeAlong(rolling, s, h.LineM, w); math.Abs(got-scratch) > 0.5 {
			t.Errorf("%v W from %.0f m reaches the line in %.1f s, with the scratch rider's %.1f s", w, s, got, scratch)
		}
	}
	if h.Start(250) >= h.Start(180) {
		t.Errorf("a weaker rider starts behind a stronger one: %.0f m and %.0f m", h.Start(250), h.Start(180))
	}
	short := NewHandicap(flat(5_000), par, 300)
	if short.LineM != 5_000 {
		t.Errorf("a 5 km road's line at %.0f m", short.LineM)
	}
}
