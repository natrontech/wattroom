package stats

import (
	"math"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

const workoutJSON = `{"name":"t","steps":[
	{"type":"warmup","seconds":60,"from":0.4,"to":0.7},
	{"type":"repeat","times":2,"steps":[
		{"type":"steady","seconds":30,"target":1.0},
		{"type":"steady","seconds":30,"target":0.5}
	]},
	{"type":"cooldown","seconds":60,"from":0.6,"to":0.4}
]}`

// flat is `seconds` samples at `watts`, with no bias — the shape every sample
// recorded before #795 has, and what a client that sends none produces.
func flat(watts, seconds int) []protocol.RiderMetrics {
	return biased(watts, seconds, 0)
}

// biased is the same, with the rider's trim on their own targets.
func biased(watts, seconds int, bias float64) []protocol.RiderMetrics {
	out := make([]protocol.RiderMetrics, seconds)
	for i := range out {
		out[i] = protocol.RiderMetrics{Watts: watts, Bias: bias}
	}
	return out
}

func ride(blocks ...[]protocol.RiderMetrics) []protocol.RiderMetrics {
	var out []protocol.RiderMetrics
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
	watts := wattsOnly(flat(200, 1200))
	for i := 600; i < 605; i++ {
		watts[i] = 800
	}
	c := PowerCurve(watts)
	if c.Best5s != 800 || c.Best20m < 200 {
		t.Fatalf("curve: %+v", c)
	}
	if got := PowerCurve(wattsOnly(flat(300, 90))); got.Best5m != 0 || got.Best1m != 300 {
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

func TestSuggestFTP(t *testing.T) {
	// 0.95 × 300 = 285 > 265 × 1.02 = 270.3 → suggest 285.
	if got, ok := SuggestFTP(300, 265); !ok || got != 285 {
		t.Fatalf("suggest: %d %v", got, ok)
	}
	// 0.95 × 280 = 266, within 2 % of 265 → silence.
	if _, ok := SuggestFTP(280, 265); ok {
		t.Fatal("suggested inside the tolerance")
	}
	if _, ok := SuggestFTP(0, 265); ok {
		t.Fatal("suggested from no data")
	}
}

// wattsOnly is what PowerCurve still takes: a bare series.
func wattsOnly(samples []protocol.RiderMetrics) []int {
	out := make([]int, len(samples))
	for i, s := range samples {
		out[i] = s.Watts
	}
	return out
}

func TestExecutionScoresAgainstTheRidersOwnTarget(t *testing.T) {
	// #795, settled by the maintainer: bias means "this is the plan I am on
	// today", and the score answers whether they rode the plan they were on.
	// At −20 % the hard blocks want 160 W and the easy ones 80 W.
	samples := ride(flat(1, 60), biased(160, 30, 0.8), biased(80, 30, 0.8),
		biased(160, 30, 0.8), biased(80, 30, 0.8))
	got, err := Execution(workoutJSON, 200, samples)
	if err != nil || got != 1 {
		t.Fatalf("a rider who nailed their own targets scored %v (%v)", got, err)
	}

	// And riding the PRESCRIBED watts while dialled down is now a miss —
	// which is the honest reading of "did you ride the plan you were on".
	over := ride(flat(1, 60), biased(200, 30, 0.8), biased(100, 30, 0.8),
		biased(200, 30, 0.8), biased(100, 30, 0.8))
	if got, err := Execution(workoutJSON, 200, over); err != nil || got != 0 {
		t.Fatalf("riding 25%% over their own target scored %v (%v)", got, err)
	}
}

func TestExecutionWeightsByThePrescribedIntensity(t *testing.T) {
	// The weight is the intensity the WORKOUT asked for, not the biased one:
	// dialling down must not also quietly reduce how much a hard block counts
	// for, or bias would move the score twice.
	easy := Execution
	full, err := easy(workoutJSON, 200, ride(flat(1, 60), flat(200, 30), flat(300, 30), flat(200, 30), flat(300, 30)))
	if err != nil {
		t.Fatal(err)
	}
	// The same ride at −20 %: on target for the hard blocks, 87 % over on the
	// easy ones. Same shape, so the same weighted score.
	down, err := easy(workoutJSON, 200, ride(flat(1, 60), biased(160, 30, 0.8), biased(240, 30, 0.8),
		biased(160, 30, 0.8), biased(240, 30, 0.8)))
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(full-down) > 0.001 {
		t.Errorf("bias changed the weighting: %v vs %v", full, down)
	}
}
