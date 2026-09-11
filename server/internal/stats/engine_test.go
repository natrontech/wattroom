package stats

import (
	"math"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/workout"
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

// clocked is `seconds` samples at `watts`, each stamped with the workout
// second it was ridden at from `start` up — what a solo ride sends (#1733).
func clocked(watts, seconds, start int) []protocol.RiderMetrics {
	out := make([]protocol.RiderMetrics, seconds)
	for i := range out {
		out[i] = protocol.RiderMetrics{Watts: watts, Clock: start + i}
	}
	return out
}

// stopped is `seconds` samples of a rider who has stopped: the workout clock
// holds at `at` while the wall clock — the array — keeps counting.
func stopped(seconds, at int) []protocol.RiderMetrics {
	out := make([]protocol.RiderMetrics, seconds)
	for i := range out {
		out[i] = protocol.RiderMetrics{Clock: at}
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
	got, _, err := Execution(workoutJSON, 200, samples)
	if err != nil || got != 1 {
		t.Fatalf("perfect ride scored %v (%v)", got, err)
	}
}

func TestExecutionWeightsIntensity(t *testing.T) {
	// Nail the hard blocks (weight 1.0), miss the easy ones (weight 0.5):
	// 2·1.0 / (2·1.0 + 2·0.5) = 2/3 — not the unweighted 1/2 (SPEC weighting).
	samples := ride(flat(1, 60), flat(200, 30), flat(300, 30), flat(200, 30), flat(300, 30))
	got, _, err := Execution(workoutJSON, 200, samples)
	if err != nil || math.Abs(got-2.0/3.0) > 0.01 {
		t.Fatalf("weighted score: %v (%v)", got, err)
	}
}

func TestExecutionExcludesUnriddenSeconds(t *testing.T) {
	// 0 W through one hard block: those seconds drop out (the auto-pause
	// exclusion) rather than scoring as misses.
	samples := ride(flat(1, 60), flat(200, 30), flat(100, 30), flat(0, 30), flat(100, 30))
	got, _, err := Execution(workoutJSON, 200, samples)
	if err != nil || got != 1 {
		t.Fatalf("unridden seconds scored: %v (%v)", got, err)
	}
}

func TestExecutionBandFloorsAtTenWatts(t *testing.T) {
	// SPEC: ±5 % of target, floor ±10 W. At 60 W the 5 % band is 3 W; the
	// floor makes it 10: 66 W is in, 72 W is out. Nothing exercised the
	// floor before — every case used targets where 5 % is already ≥ 10 W
	// (audit 2026-09-09).
	const easy = `{"name":"e","steps":[{"type":"steady","seconds":30,"target":0.3}]}`
	if got, _, err := Execution(easy, 200, flat(66, 30)); err != nil || got != 1 {
		t.Fatalf("66 W against 60 W (floor ±10) scored %v (%v), want 1", got, err)
	}
	if got, _, err := Execution(easy, 200, flat(72, 30)); err != nil || got != 0 {
		t.Fatalf("72 W against 60 W (floor ±10) scored %v (%v), want 0", got, err)
	}
}

func TestCompletedReachesTheFinalSegment(t *testing.T) {
	segments, err := workout.Parse(workoutJSON)
	if err != nil {
		t.Fatal(err)
	}
	// warmup 60 + 2×(30+30) + cooldown 60: the cooldown starts at 180.
	if Completed(segments, 180) {
		t.Error("a ride that stopped as the final segment began counts as completed")
	}
	if !Completed(segments, 181) {
		t.Error("a ride into the final segment does not count as completed")
	}
	if !Completed(nil, 0) {
		t.Error("a workout with no segments has nothing to complete")
	}
}

func TestExecutionJunkJSON(t *testing.T) {
	if _, _, err := Execution("{", 200, flat(200, 10)); err == nil {
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
	got, _, err := Execution(workoutJSON, 200, samples)
	if err != nil || got != 1 {
		t.Fatalf("a rider who nailed their own targets scored %v (%v)", got, err)
	}

	// And riding the PRESCRIBED watts while dialled down is now a miss —
	// which is the honest reading of "did you ride the plan you were on".
	over := ride(flat(1, 60), biased(200, 30, 0.8), biased(100, 30, 0.8),
		biased(200, 30, 0.8), biased(100, 30, 0.8))
	if got, _, err := Execution(workoutJSON, 200, over); err != nil || got != 0 {
		t.Fatalf("riding 25%% over their own target scored %v (%v)", got, err)
	}
}

// A ride that stamps its samples with the workout second is scored by it
// (#1733). The record counts wall seconds and the workout clock stops while
// auto-paused, so by index a 30 s stop mid-block shifted every later second
// onto the wrong block — here the second half of the first hard block onto
// the easy one — and the saved score disagreed with the one the rider
// watched all session.
func TestExecutionScoresByTheWorkoutClock(t *testing.T) {
	paused := ride(clocked(1, 60, 0),
		clocked(200, 15, 60), stopped(30, 74), clocked(200, 15, 75),
		clocked(100, 30, 90), clocked(200, 30, 120), clocked(100, 30, 150))
	got, _, err := Execution(workoutJSON, 200, paused)
	if err != nil || got != 1 {
		t.Fatalf("a rider who paused mid-block and then hit every target scored %v (%v)", got, err)
	}
	// And a ride that sends no stamp — a room ride, or an old record — still
	// scores by index, so nothing already saved reads differently.
	if got, _, err := Execution(workoutJSON, 200, ride(flat(1, 60), flat(200, 30), flat(100, 30), flat(200, 30), flat(100, 30))); err != nil || got != 1 {
		t.Fatalf("an unstamped ride scored %v (%v)", got, err)
	}
}

// A second the rider's own guard released — auto-pause, the resume count,
// the spiral — is not a miss (#1796): the live meter never scored it, and
// the saved ride used to, against the full target. Here the second hard
// block is ridden released at 40 W, which by index scoring is thirty misses.
func TestExecutionSkipsReleasedSeconds(t *testing.T) {
	released := biased(40, 30, 0)
	for i := range released {
		released[i].Released = true
	}
	got, _, err := Execution(workoutJSON, 200, ride(flat(1, 60), flat(200, 30), flat(100, 30), released, flat(100, 30)))
	if err != nil || got != 1 {
		t.Fatalf("a released block counted against the rider: %v (%v)", got, err)
	}
}

func TestExecutionWeightsByThePrescribedIntensity(t *testing.T) {
	// The weight is the intensity the WORKOUT asked for, not the biased one:
	// dialling down must not also quietly reduce how much a hard block counts
	// for, or bias would move the score twice.
	easy := Execution
	full, _, err := easy(workoutJSON, 200, ride(flat(1, 60), flat(200, 30), flat(300, 30), flat(200, 30), flat(300, 30)))
	if err != nil {
		t.Fatal(err)
	}
	// The same ride at −20 %: on target for the hard blocks, 87 % over on the
	// easy ones. Same shape, so the same weighted score.
	down, _, err := easy(workoutJSON, 200, ride(flat(1, 60), biased(160, 30, 0.8), biased(240, 30, 0.8),
		biased(160, 30, 0.8), biased(240, 30, 0.8)))
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(full-down) > 0.001 {
		t.Errorf("bias changed the weighting: %v vs %v", full, down)
	}
}

// #1143: the three cases Execution must tell apart.
func TestExecutionDistinguishesNothingToScoreFromPerfect(t *testing.T) {
	const scorable = `{"name":"t","steps":[
		{"type":"warmup","seconds":60,"from":0.4,"to":0.7},
		{"type":"steady","seconds":60,"target":1.0}]}`
	const unscorable = `{"name":"t","steps":[
		{"type":"warmup","seconds":60,"from":0.4,"to":0.7},
		{"type":"sprint","seconds":30},
		{"type":"cooldown","seconds":60,"from":0.6,"to":0.4}]}`

	// A rider with no power against targets that existed executed none of it.
	score, ok, err := Execution(scorable, 200, ride(flat(0, 120)))
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Error("a workout with a steady step is scorable")
	}
	if score != 0 {
		t.Errorf("no power against real targets scored %v, want 0", score)
	}

	// A workout that prescribes nothing is not scorable, whatever was ridden.
	_, ok, err = Execution(unscorable, 200, ride(flat(200, 150)))
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Error("a workout of warmup, sprint and cooldown has nothing to score")
	}
}

// #1400: the ramp test is saved as a ride, and the ride is not scored. Its
// steps are steady targets, so Scorable alone says yes and the rider — held
// on the target by ERG — scores near 1.0 for riding to failure. The workout
// declaring itself unscored is what stops that reaching the row and the XP.
func TestExecutionHonoursAWorkoutThatDeclaresItselfUnscored(t *testing.T) {
	// The ramp's shape: a warmup, then steady steps in absolute watts.
	steps := `{"type":"warmup","seconds":60,"from":0.35,"to":0.5},
		{"type":"steady","seconds":60,"watts":100},
		{"type":"steady","seconds":60,"watts":120}`
	scored := `{"name":"Ramp test","steps":[` + steps + `]}`
	declared := `{"name":"Ramp test","unscored":true,"steps":[` + steps + `]}`

	// On target throughout, which is what a trainer in ERG produces.
	onTarget := ride(flat(0, 60), clocked(100, 60, 60), clocked(120, 60, 120))

	score, ok, err := Execution(scored, 200, onTarget)
	if err != nil {
		t.Fatal(err)
	}
	if !ok || score < 0.99 {
		t.Fatalf("undeclared: scored=%v score=%v, want scorable and ~1 (the score this fixes)", ok, score)
	}

	score, ok, err = Execution(declared, 200, onTarget)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Error("a workout carrying unscored:true is not scorable")
	}
	// Zero, not the computed number: XP pays execution × 50 off this value
	// whatever the flag says, so a score left in it would still be paid out.
	if score != 0 {
		t.Errorf("unscored workout scored %v, want 0", score)
	}
}

// The zone boundaries are docs/SPEC.md's table read at its edges: Z1 is
// "≤ 55 %", so 55 % of FTP is Z1 and a watt more is Z2. An off-by-one here is
// silent — every ride still renders, in the wrong colour.
func TestPowerZone(t *testing.T) {
	const ftp = 200
	for _, tc := range []struct {
		watts, want int
	}{
		{0, 1}, {110, 1}, // ≤ 55 %
		{111, 2}, {150, 2}, // 56–75 %
		{151, 3}, {180, 3}, // 76–90 %
		{181, 4}, {210, 4}, // 91–105 %
		{211, 5}, {240, 5}, // 106–120 %
		{241, 6}, {300, 6}, // 121–150 %
		{301, 7}, {1400, 7}, // > 150 %
	} {
		if got := PowerZone(tc.watts, ftp); got != tc.want {
			t.Errorf("PowerZone(%d, %d) = Z%d, want Z%d", tc.watts, ftp, got, tc.want)
		}
	}
	// An account with no FTP has no zones to divide by; Z1 beats a panic.
	if got := PowerZone(300, 0); got != 1 {
		t.Errorf("PowerZone with no FTP = Z%d, want Z1", got)
	}
}
