package hub

import "testing"

// The cadence a block asks for (docs/SPEC.md "BPM matching"): the band when
// the workout names one, else the effort tiers, else nothing.
func TestSessionMoodTargetRPM(t *testing.T) {
	for _, tc := range []struct {
		name string
		mood SessionMood
		want int
	}{
		{"nothing running", SessionMood{}, 0},
		{"absolute watts or a sprint", SessionMood{TargetPct: 0}, 0},
		{"recovery", SessionMood{TargetPct: 0.5}, 80},
		{"endurance", SessionMood{TargetPct: 0.7}, 85},
		{"sweet spot", SessionMood{TargetPct: 0.88}, 90},
		{"vo2", SessionMood{TargetPct: 1.1}, 95},
		{"a band beats the tier", SessionMood{TargetPct: 1.1, CadenceLow: 60, CadenceHigh: 70}, 65},
		{"one bound only", SessionMood{TargetPct: 0.5, CadenceHigh: 100}, 100},
	} {
		if got := tc.mood.TargetRPM(); got != tc.want {
			t.Errorf("%s: TargetRPM() = %d, want %d", tc.name, got, tc.want)
		}
	}
}
