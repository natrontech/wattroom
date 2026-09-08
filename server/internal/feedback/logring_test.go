package feedback

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
)

// ring wires a LogRing over a JSON handler at the given stdout level, the
// same shape main.go builds.
func ring(t *testing.T, level slog.Level) (*LogRing, *bytes.Buffer) {
	t.Helper()
	var out bytes.Buffer
	r := NewLogRing(slog.NewJSONHandler(&out, &slog.HandlerOptions{Level: level}))
	return r, &out
}

// #1098: LogRing is the OUTER handler, so slog asks it first. A floor pinned
// at Info here drops a Debug record before stdout is ever consulted, which
// made every log.Debug call in the server dead code — including the cue
// lines #152 wrote for headless diagnosis, which had never once printed.
func TestDebugReachesStdoutWhenStdoutAsksForIt(t *testing.T) {
	for _, tc := range []struct {
		name  string
		level slog.Level
		want  bool
	}{
		{"debug stdout prints debug", slog.LevelDebug, true},
		{"info stdout does not", slog.LevelInfo, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r, out := ring(t, tc.level)
			slog.New(r).Debug("smart shuffle picked", "weight", 3)

			if got := strings.Contains(out.String(), "smart shuffle picked"); got != tc.want {
				t.Errorf("printed = %v, want %v (stdout at %s). Output: %q", got, tc.want, tc.level, out.String())
			}
		})
	}
}

// The ring's own contract, which the old floor was defending in the wrong
// place: it keeps Info and above for the feedback report WHATEVER stdout is
// set to. Losing this is invisible — reports keep arriving, just emptier.
func TestTheRingKeepsInfoEvenWhenStdoutIsQuiet(t *testing.T) {
	r, out := ring(t, slog.LevelError)
	log := slog.New(r)
	log.Info("room opened", "room", "velvet")
	log.Warn("autoplay queue full", "room", "velvet")

	if strings.Contains(out.String(), "room opened") {
		t.Errorf("an error-level stdout printed an info line: %q", out.String())
	}
	snap := strings.Join(r.Snapshot(), "\n")
	for _, want := range []string{"room opened", "autoplay queue full", "room=velvet"} {
		if !strings.Contains(snap, want) {
			t.Errorf("the report lost %q. Ring: %q", want, snap)
		}
	}
}

// ...and does NOT keep debug, whatever stdout is doing. The ring is 400
// lines; a debug-level server would push every line a rider's report needs
// out of it within seconds, and the report would still look fine.
func TestTheRingDoesNotKeepDebugEvenWhenStdoutDoes(t *testing.T) {
	r, out := ring(t, slog.LevelDebug)
	log := slog.New(r)
	log.Debug("chasing playhead", "drift", 0.2)
	log.Info("room opened", "room", "velvet")

	if !strings.Contains(out.String(), "chasing playhead") {
		t.Fatalf("debug did not reach stdout, so this test proves nothing: %q", out.String())
	}
	snap := strings.Join(r.Snapshot(), "\n")
	if strings.Contains(snap, "chasing playhead") {
		t.Errorf("debug flooded the report ring: %q", snap)
	}
	if !strings.Contains(snap, "room opened") {
		t.Errorf("the ring dropped the info line too: %q", snap)
	}
}

// WithAttrs/WithGroup hand out a ringChild, and a child that filtered
// differently from its parent would be a bug nobody sees: most of the server
// logs through `log.With(...)`, not the root handler.
func TestADerivedHandlerBehavesLikeItsParent(t *testing.T) {
	r, out := ring(t, slog.LevelDebug)
	log := slog.New(r).With("room", "velvet")
	log.Debug("chasing playhead")
	log.Info("room opened")

	if !strings.Contains(out.String(), "chasing playhead") {
		t.Errorf("a derived handler swallowed debug: %q", out.String())
	}
	snap := strings.Join(r.Snapshot(), "\n")
	if strings.Contains(snap, "chasing playhead") {
		t.Errorf("a derived handler put debug in the report ring: %q", snap)
	}
	if !strings.Contains(snap, "room opened") {
		t.Errorf("a derived handler's info never reached the ring: %q", snap)
	}
}

// Enabled is what slog asks before building a record, so it has to answer for
// both jobs — not just the one the handler happens to be named after.
func TestEnabledAnswersForTheRingAndForStdout(t *testing.T) {
	quiet, _ := ring(t, slog.LevelError)
	loud, _ := ring(t, slog.LevelDebug)
	ctx := context.Background()

	if !quiet.Enabled(ctx, slog.LevelInfo) {
		t.Error("a quiet stdout disabled info, which the ring still wants")
	}
	if quiet.Enabled(ctx, slog.LevelDebug) {
		t.Error("nothing wanted debug and it was enabled anyway")
	}
	if !loud.Enabled(ctx, slog.LevelDebug) {
		t.Error("stdout asked for debug and it was refused")
	}
}
