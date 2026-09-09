package workout

import (
	"errors"
	"strings"
	"testing"
)

// One case per rule the editor enforces, now enforced here too (audit
// 2026-09-09): the two must not disagree, or a workout is stored and then
// silently dropped from the shelf.
func TestValidateMirrorsTheEditor(t *testing.T) {
	steady := func(extra string) string {
		return `{"steps":[{"type":"steady","seconds":600,"target":0.8` + extra + `}]}`
	}
	cases := []struct {
		name string
		json string
		want string // a fragment of the refusal, "" for accepted
	}{
		{"a plain steady block", steady(""), ""},
		{"a two-second step", `{"steps":[{"type":"steady","seconds":2,"target":0.8}]}`, "shorter than 5s"},
		{"a five-hour step", `{"steps":[{"type":"steady","seconds":18001,"target":0.8}]}`, "longer than 4 hours"},
		{"a 2500 % target", `{"steps":[{"type":"steady","seconds":600,"target":25}]}`, "above the 300% ceiling"},
		{"no target at all", `{"steps":[{"type":"steady","seconds":600}]}`, "target must be above 0"},
		{"absolute watts", steady(`,"watts":250`), ""},
		{"absurd watts", steady(`,"watts":5000`), "outside 1–3000"},
		{"a cadence band", steady(`,"cadenceLow":85,"cadenceHigh":95`), ""},
		{"a cadence floor on the guard", steady(`,"cadenceLow":50`), "spiral guard"},
		{"a cadence band upside down", steady(`,"cadenceLow":100,"cadenceHigh":80`), "upside down"},
		{"an HR band past a heart", steady(`,"hrLow":100,"hrHigh":230`), "outside 60–220"},
		{"a warm-up", `{"steps":[{"type":"warmup","seconds":300,"from":0.35,"to":0.5}]}`, ""},
		{"a ramp to nowhere", `{"steps":[{"type":"ramp","seconds":300,"from":0.5}]}`, "to must be above 0"},
		{"a sprint", `{"steps":[{"type":"sprint","seconds":15}]}`, ""},
		{"a freeride", `{"steps":[{"type":"freeride","seconds":600}]}`, "unknown step type"},
		{"zero repeats", `{"steps":[{"type":"repeat","times":0,"steps":[{"type":"sprint","seconds":15}]}]}`, "outside 1–50"},
		{"an empty repeat", `{"steps":[{"type":"repeat","times":3,"steps":[]}]}`, "at least one step"},
		{"a bad step inside a repeat", `{"steps":[{"type":"repeat","times":3,"steps":[{"type":"steady","seconds":1,"target":1}]}]}`, "Step 1 → step 1: steps shorter"},
		{"no steps", `{"steps":[]}`, "at least one step"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := Validate(c.json)
			if c.want == "" && err != nil {
				t.Fatalf("refused: %v", err)
			}
			if c.want != "" && (err == nil || !strings.Contains(err.Error(), c.want)) {
				t.Fatalf("got %v, want a refusal mentioning %q", err, c.want)
			}
		})
	}
}

// The rider reads the validator's sentence and nothing else's (#1643).
func TestRefusalMessage(t *testing.T) {
	if msg, ok := RefusalMessage(Validate("not json")); !ok || msg == "" {
		t.Fatalf("a refusal has a message: %q %v", msg, ok)
	}
	if _, ok := RefusalMessage(errors.New("pgx: connection reset")); ok {
		t.Fatal("any other error is not a message")
	}
}
