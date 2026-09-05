package feedback

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store/db"
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

type fakeSessions struct{ user db.User }

func (f fakeSessions) RequireUser(http.ResponseWriter, *http.Request, string) (db.User, bool) {
	return f.user, true
}

type captureIssuer struct{ body string }

func (c *captureIssuer) FileOrComment(_, _, body string) (string, error) {
	c.body = body
	return "https://github.com/natrontech/wattroom/issues/1", nil
}

// A client that still ships heart rate — an old cached build, or a hostile
// one — must not get it into a public issue or onto disk (#636).
func TestSubmitStripsHeartRate(t *testing.T) {
	t.Setenv("WATTROOM_FEEDBACK_DIR", t.TempDir())
	issuer := &captureIssuer{}
	svc := New(fakeSessions{db.User{DisplayName: "velvet"}}, issuer, NewLogRing(slog.DiscardHandler), slog.New(slog.DiscardHandler))
	mux := http.NewServeMux()
	svc.Register(mux)

	payload := `{"route":"/ride","note":"erg felt off","firstError":"","clientBuild":"dev",
		"userAgent":"vitest","trainer":"Kickr","clientMs":1700000000000,
		"buffer":{"ticks":[{"at":1,"watts":210,"cadence":88,"heartRate":151,"target":200,"state":"riding","second":41}],
		"events":[{"at":1,"kind":"ride","text":"starting Sweet Spot"}],
		"errors":[{"at":2,"text":"boom"}]}}`
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/feedback", strings.NewReader(payload)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}

	for name, text := range map[string]string{"issue": issuer.body, "disk": readReports(t, svc.dir)} {
		if strings.Contains(text, "heartRate") || strings.Contains(text, "151") {
			t.Fatalf("%s carries heart rate:\n%s", name, text)
		}
		// The debug story survives the stripping.
		for _, want := range []string{`"watts":210`, `"cadence":88`, `"target":200`, `"state":"riding"`, "starting Sweet Spot", "boom"} {
			if !strings.Contains(text, want) {
				t.Fatalf("%s lost %s:\n%s", name, want, text)
			}
		}
	}
	if strings.Contains(issuer.body, "second") {
		t.Fatalf("unlisted field reached the issue:\n%s", issuer.body)
	}
}

func TestSubmitRejectsMalformedBuffer(t *testing.T) {
	t.Setenv("WATTROOM_FEEDBACK_DIR", t.TempDir())
	svc := New(fakeSessions{db.User{DisplayName: "velvet"}}, nil, NewLogRing(slog.DiscardHandler), slog.New(slog.DiscardHandler))
	mux := http.NewServeMux()
	svc.Register(mux)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/feedback",
		strings.NewReader(`{"route":"/ride","buffer":{"ticks":"not a list"}}`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", rec.Code)
	}
}

func readReports(t *testing.T, dir string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(dir, "reports.jsonl")) //nolint:gosec // dir is t.TempDir()
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
