package workout

import (
	"fmt"
	"math"
	"strings"
	"testing"
)

// The engine refuses what it cannot afford to expand (audit 2026-09-09): the
// same ceilings the editor enforces, now at the boundary the editor is not.
func TestParseRefusesWhatWouldNotFitOnTheVM(t *testing.T) {
	nest := func(depth int) string {
		s := `{"type":"steady","seconds":60,"target":0.8}`
		for i := 0; i < depth; i++ {
			s = fmt.Sprintf(`{"type":"repeat","times":2,"steps":[%s]}`, s)
		}
		return s
	}
	cases := []struct {
		name string
		json string
		ok   bool
	}{
		{"a 3x20", `{"steps":[{"type":"repeat","times":3,"steps":[{"type":"steady","seconds":1200,"target":0.9},{"type":"steady","seconds":300,"target":0.5}]}]}`, true},
		{"fifty repeats, the editor's ceiling", `{"steps":[{"type":"repeat","times":50,"steps":[{"type":"steady","seconds":30,"target":1}]}]}`, true},
		{"one repeat too many", `{"steps":[{"type":"repeat","times":51,"steps":[{"type":"steady","seconds":30,"target":1}]}]}`, false},
		{"a million repeats", `{"steps":[{"type":"repeat","times":1000000,"steps":[{"type":"steady","seconds":1,"target":1}]}]}`, false},
		{"nested four deep", `{"steps":[` + nest(4) + `]}`, true},
		{"nested five deep", `{"steps":[` + nest(5) + `]}`, false},
		{"more blocks than any ride", `{"steps":[` + strings.Repeat(`{"type":"steady","seconds":10,"target":1},`, 200) + `{"type":"steady","seconds":10,"target":1}]}`, false},
		{"a negative count", `{"steps":[{"type":"repeat","times":-1,"steps":[{"type":"steady","seconds":30,"target":1}]}]}`, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			segments, err := Parse(c.json)
			if c.ok && (err != nil || len(segments) == 0) {
				t.Fatalf("refused a workout the engine should ride: %v (%d segments)", err, len(segments))
			}
			if !c.ok && err == nil {
				t.Fatalf("expanded to %d segments; want ErrTooBig", len(segments))
			}
		})
	}
}

// The editor's ramp is a ramp to the server too (#1709): the fraction moves
// every second from `from` toward `to`, unscored like warmup and cooldown.
//
// Asserting the midpoint alone did not pin that. A rampPct returning the
// constant (from+to)/2 sits exactly on the midpoint, so it held every
// assertion this test used to make and no test on the server went red — a
// ramp could go flat and ship (#1394). The per-second delta is what says
// "ramp", so that is what is asserted, on all three kinds that share the
// one interpolation.
func TestARampInterpolatesAcrossTheStep(t *testing.T) {
	const (
		ftp     = 200.0
		seconds = 300
	)
	cases := []struct {
		name     string
		kind     string
		from, to float64
	}{
		{"the editor's mid-workout ramp", "ramp", 0.5, 0.8},
		{"a warmup rising", "warmup", 0.4, 0.7},
		{"a cooldown falling", "cooldown", 0.6, 0.35},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			segments, err := Parse(fmt.Sprintf(
				`{"steps":[{"type":%q,"seconds":%d,"from":%v,"to":%v}]}`,
				tc.kind, seconds, tc.from, tc.to))
			if err != nil || len(segments) != 1 {
				t.Fatalf("parse: %v, %d segments", err, len(segments))
			}
			pctAt := func(second int) float64 {
				seg, pct, ok := SegmentAt(segments, second)
				if !ok {
					t.Fatalf("second %d is outside the block", second)
				}
				if seg.Kind != tc.kind {
					t.Fatalf("second %d is a %q block, want %q", second, seg.Kind, tc.kind)
				}
				// The two readers must not drift: TargetAt's watts are
				// SegmentAt's fraction of FTP, and a ramp is never scored.
				watts, scored := TargetAt(segments, ftp, second)
				if scored {
					t.Fatalf("second %d is scored; a %s asks for effort, not a number", second, tc.kind)
				}
				if math.Abs(watts-pct*ftp) > 0.001 {
					t.Fatalf("second %d: TargetAt %v W, SegmentAt %v of %v FTP", second, watts, pct, ftp)
				}
				return pct
			}

			// The block opens on `from` and closes one second short of `to`:
			// the last second of a ramp is still ramping, and the end target
			// is where the next block starts.
			step := (tc.to - tc.from) / seconds
			if got := pctAt(0); math.Abs(got-tc.from) > 0.001 {
				t.Errorf("first second = %v, want from %v", got, tc.from)
			}
			if got, want := pctAt(seconds-1), tc.to-step; math.Abs(got-want) > 0.001 {
				t.Errorf("last second = %v, want %v (one step short of to)", got, want)
			}

			// Every second moves by the same non-zero amount, in the
			// direction of travel. This is the assertion a flat ramp fails.
			if step == 0 {
				t.Fatal("the case itself does not ramp")
			}
			prev := pctAt(0)
			for second := 1; second < seconds; second++ {
				pct := pctAt(second)
				if delta := pct - prev; math.Abs(delta-step) > 0.001 {
					t.Fatalf("second %d moved by %v, want %v per second", second, delta, step)
				}
				prev = pct
			}
		})
	}
}

func TestUnscored(t *testing.T) {
	for _, tc := range []struct {
		name string
		json string
		want bool
	}{
		{"absent is scored", `{"name":"t","steps":[]}`, false},
		{"declared", `{"name":"t","unscored":true,"steps":[]}`, true},
		{"declared false", `{"name":"t","unscored":false,"steps":[]}`, false},
		// Parse reports the error; this answers the safe way rather than
		// handing an unreadable workout a free pass out of scoring.
		{"junk", `{`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := Unscored(tc.json); got != tc.want {
				t.Errorf("Unscored = %v, want %v", got, tc.want)
			}
		})
	}
}
