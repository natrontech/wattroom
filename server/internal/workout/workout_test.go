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
