package feedback

import (
	"log/slog"
	"strings"
	"testing"
)

func TestFingerprintDedup(t *testing.T) {
	// One bad interval in a group ride: eight riders, one fingerprint.
	base := Fingerprint("abc123", "TypeError: x is undefined\n  at ride.ts:40", "/ride")
	cases := []struct {
		name            string
		sha, err, route string
		wantSame        bool
	}{
		{"same error, different stack depth", "abc123", "TypeError: x is undefined\n  at other.ts:99\n  deeper", "/ride", true},
		{"different build", "def456", "TypeError: x is undefined", "/ride", false},
		{"different route", "abc123", "TypeError: x is undefined", "/r/velvet", false},
		{"different error", "abc123", "RangeError: y", "/ride", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Fingerprint(tc.sha, tc.err, tc.route)
			if (got == base) != tc.wantSame {
				t.Fatalf("fingerprint match = %v, want %v", got == base, tc.wantSame)
			}
		})
	}
}

func TestLogRingCapturesAndBounds(t *testing.T) {
	ring := NewLogRing(slog.DiscardHandler)
	log := slog.New(ring)
	for i := 0; i < ringSize+50; i++ {
		log.Info("tick", "n", i)
	}
	lines := ring.Snapshot()
	if len(lines) != ringSize {
		t.Fatalf("ring size: %d", len(lines))
	}
	// Oldest entries fell off; the newest survives with its attrs.
	if !strings.Contains(lines[len(lines)-1], "n=449") {
		t.Fatalf("last line: %q", lines[len(lines)-1])
	}
	if strings.Contains(strings.Join(lines, "\n"), "n=10 ") {
		t.Fatal("ancient line survived the ring")
	}
	// Derived handlers write into the same ring.
	slog.New(ring.WithAttrs([]slog.Attr{slog.String("room", "velvet")})).Info("derived")
	if !strings.Contains(strings.Join(ring.Snapshot(), "\n"), "derived") {
		t.Fatal("derived handler bypassed the ring")
	}
}

func TestFirstLine(t *testing.T) {
	if got := firstLine("", "boom\nstack", "/ride"); got != "boom" {
		t.Fatalf("firstLine: %q", got)
	}
	if got := firstLine("", "", ""); got != "mid-ride flag" {
		t.Fatalf("fallback: %q", got)
	}
}
