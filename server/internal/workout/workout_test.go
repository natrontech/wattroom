package workout

import (
	"fmt"
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

// The editor's ramp is a ramp to the server too (#1709): at its midpoint the
// target is the midpoint of from and to, unscored like warmup and cooldown.
func TestARampStepHasATarget(t *testing.T) {
	segments, err := Parse(`{"steps":[{"type":"ramp","seconds":300,"from":0.5,"to":0.8}]}`)
	if err != nil || len(segments) != 1 {
		t.Fatalf("parse: %v %d", err, len(segments))
	}
	watts, scored := TargetAt(segments, 200, 150)
	if watts < 129 || watts > 131 || scored {
		t.Fatalf("midpoint: %v W scored=%v, want ~130 W unscored", watts, scored)
	}
	if _, pct, ok := SegmentAt(segments, 150); !ok || pct < 0.64 || pct > 0.66 {
		t.Fatalf("SegmentAt midpoint pct = %v, want ~0.65", pct)
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
