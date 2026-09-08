package stats

import (
	"testing"

	"github.com/natrontech/wattroom/server/internal/workout"
)

func result(id string, join int, exec, cov, wkg float64) RiderResult {
	return RiderResult{UserID: id, JoinOrder: join, Execution: exec, CoV: cov, Best5sWkg: wkg, Completed: true, Scored: true}
}

func TestMedalsNeedThreeRiders(t *testing.T) {
	if Medals([]RiderResult{result("a", 0, 1, 0.1, 5), result("b", 1, 0.9, 0.2, 4)}) != nil {
		t.Fatal("medals with two riders")
	}
}

func TestMedalCriteria(t *testing.T) {
	got := Medals([]RiderResult{
		result("steady", 0, 0.80, 0.02, 6.0),
		result("precise", 1, 0.99, 0.10, 7.0),
		result("softpedal", 2, 0.70, 0.30, 3.0),
	})
	want := map[string]string{
		"diesel": "steady", "metronome": "precise",
		"hammer": "precise", "lanterne_rouge": "softpedal",
	}
	for kind, user := range want {
		if got[kind] != user {
			t.Errorf("%s: got %s want %s", kind, got[kind], user)
		}
	}
}

func TestMedalTieBreak(t *testing.T) {
	// Identical scores: the earlier joiner wins (SPEC).
	got := Medals([]RiderResult{
		result("late", 2, 0.9, 0.1, 5),
		result("early", 0, 0.9, 0.1, 5),
		result("mid", 1, 0.9, 0.1, 5),
	})
	if got["metronome"] != "early" || got["hammer"] != "early" {
		t.Fatalf("tie-break: %+v", got)
	}
}

func TestSteadyCoV(t *testing.T) {
	segments := []workout.Segment{{Kind: "warmup", Start: 0, Seconds: 10}, {Kind: "steady", Start: 10, Seconds: 10}}
	// Wild warmup, dead-steady block: CoV must only see the steady seconds.
	watts := []int{50, 400, 50, 400, 50, 400, 50, 400, 50, 400,
		200, 200, 200, 200, 200, 200, 200, 200, 200, 200}
	if got := SteadyCoV(segments, watts); got != 0 {
		t.Fatalf("steady CoV: %v", got)
	}
	// Nothing steady ridden → worst possible, not a crash.
	if got := SteadyCoV(segments, watts[:5]); got < 1e300 {
		t.Fatalf("empty CoV: %v", got)
	}
}

// #1143. A rider whose power source produced nothing scores 0 and has no
// Best5sWkg, and used to take BOTH Metronome (its old 1.0 beat everyone) and
// Lanterne Rouge (its 0 w/kg was the lowest) off riders who did the work.
func TestARiderWithNoPowerWinsNoMedal(t *testing.T) {
	dead := RiderResult{UserID: "dead", JoinOrder: 0, Execution: 0, CoV: 0, Best5sWkg: 0, Completed: true, Scored: true}
	got := Medals([]RiderResult{
		dead,
		result("precise", 1, 0.99, 0.10, 7.0),
		result("softpedal", 2, 0.70, 0.30, 3.0),
	})
	for kind, winner := range got {
		if winner == "dead" {
			t.Errorf("%s went to a rider with no power", kind)
		}
	}
	if got["metronome"] != "precise" {
		t.Errorf("metronome = %q, want precise", got["metronome"])
	}
	if got["lanterne_rouge"] != "softpedal" {
		t.Errorf("lanterne_rouge = %q, want softpedal", got["lanterne_rouge"])
	}
}

// A workout with nothing to score awards no Metronome at all, rather than
// handing it to whoever joined first on a field of tied zeroes.
func TestNoMetronomeWhenTheWorkoutScoredNothing(t *testing.T) {
	unscored := func(id string, join int, wkg float64) RiderResult {
		return RiderResult{UserID: id, JoinOrder: join, Execution: 0, CoV: 0.1, Best5sWkg: wkg, Completed: true, Scored: false}
	}
	got := Medals([]RiderResult{unscored("a", 0, 5), unscored("b", 1, 6), unscored("c", 2, 4)})
	if id, ok := got["metronome"]; ok {
		t.Errorf("metronome awarded on an unscorable workout, to %q", id)
	}
	// The others still work — a sprint session is still a session.
	if got["hammer"] != "b" || got["lanterne_rouge"] != "c" {
		t.Errorf("hammer=%q lanterne=%q, want b and c", got["hammer"], got["lanterne_rouge"])
	}
}
