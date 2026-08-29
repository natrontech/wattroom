package stats

import (
	"math"
	"testing"
)

const workoutJSON = `{"name":"t","steps":[
	{"type":"warmup","seconds":60,"from":0.4,"to":0.7},
	{"type":"repeat","times":2,"steps":[
		{"type":"steady","seconds":30,"target":1.0},
		{"type":"steady","seconds":30,"target":0.5}
	]},
	{"type":"cooldown","seconds":60,"from":0.6,"to":0.4}
]}`

func flat(watts, seconds int) []int {
	out := make([]int, seconds)
	for i := range out {
		out[i] = watts
	}
	return out
}

func ride(blocks ...[]int) []int {
	var out []int
	for _, b := range blocks {
		out = append(out, b...)
	}
	return out
}

func TestExecutionPerfectRide(t *testing.T) {
	// FTP 200: hard blocks want 200 W, easy 100 W. Ride exactly on target;
	// warmup and cooldown power is irrelevant to the score.
	samples := ride(flat(1, 60), flat(200, 30), flat(100, 30), flat(200, 30), flat(100, 30), flat(1, 60))
	got, err := Execution(workoutJSON, 200, samples)
	if err != nil || got != 1 {
		t.Fatalf("perfect ride scored %v (%v)", got, err)
	}
}

func TestExecutionWeightsIntensity(t *testing.T) {
	// Nail the hard blocks (weight 1.0), miss the easy ones (weight 0.5):
	// 2·1.0 / (2·1.0 + 2·0.5) = 2/3 — not the unweighted 1/2 (SPEC weighting).
	samples := ride(flat(1, 60), flat(200, 30), flat(300, 30), flat(200, 30), flat(300, 30))
	got, err := Execution(workoutJSON, 200, samples)
	if err != nil || math.Abs(got-2.0/3.0) > 0.01 {
		t.Fatalf("weighted score: %v (%v)", got, err)
	}
}

func TestExecutionExcludesUnriddenSeconds(t *testing.T) {
	// 0 W through one hard block: those seconds drop out (the auto-pause
	// exclusion) rather than scoring as misses.
	samples := ride(flat(1, 60), flat(200, 30), flat(100, 30), flat(0, 30), flat(100, 30))
	got, err := Execution(workoutJSON, 200, samples)
	if err != nil || got != 1 {
		t.Fatalf("unridden seconds scored: %v (%v)", got, err)
	}
}

func TestExecutionJunkJSON(t *testing.T) {
	if _, err := Execution("{", 200, flat(200, 10)); err == nil {
		t.Fatal("junk json accepted")
	}
}

func TestPowerCurve(t *testing.T) {
	watts := flat(200, 1200)
	for i := 600; i < 605; i++ {
		watts[i] = 800
	}
	c := PowerCurve(watts)
	if c.Best5s != 800 || c.Best20m < 200 {
		t.Fatalf("curve: %+v", c)
	}
	if got := PowerCurve(flat(300, 90)); got.Best5m != 0 || got.Best1m != 300 {
		t.Fatalf("short-ride curve honesty: %+v", got)
	}
}

func TestXPAndCategory(t *testing.T) {
	// SPEC: 1 kJ = 1 XP + execution% × 50 → 400 + 45.
	if got := XP(400, 0.9); got != 445 {
		t.Fatalf("xp: %d", got)
	}
	if Category(320, 80) != "A" || Category(330, 100) != "B" ||
		Category(260, 100) != "C" || Category(200, 100) != "D" {
		t.Fatal("category thresholds")
	}
	if Category(300, 0) != "D" {
		t.Fatal("zero weight must not divide")
	}
}
