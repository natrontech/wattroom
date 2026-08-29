package stats

import (
	"testing"

	"github.com/natrontech/wattroom/server/internal/workout"
)

func result(id string, join int, exec, cov, wkg float64) RiderResult {
	return RiderResult{UserID: id, JoinOrder: join, Execution: exec, CoV: cov, Best5sWkg: wkg, Completed: true}
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
