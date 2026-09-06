package feedback

import (
	"encoding/json"
	"errors"
	"io"
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

type captureIssuer struct{ title, body string }

func (c *captureIssuer) FileOrComment(_, title, body string) (string, error) {
	c.title, c.body = title, body
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

// The reports on disk, WITHOUT the envelope each is stored in.
//
// That envelope is stamped with a nanosecond timestamp, and the privacy
// assertion above is a substring check: a run stamped ...238479151Z contains
// "151", which is the fixture's heart rate, so the test failed on the clock
// while the stripping had worked perfectly (#857). Nothing asserted here
// lives outside the report, so the envelope has no business being searched.
func readReports(t *testing.T, dir string) string {
	t.Helper()
	f, err := os.Open(filepath.Join(dir, "reports.jsonl")) //nolint:gosec // dir is t.TempDir()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	// One JSON object per line; take the report out of each.
	var reports []string
	dec := json.NewDecoder(f)
	for {
		var record struct {
			Report json.RawMessage `json:"report"`
		}
		if err := dec.Decode(&record); errors.Is(err, io.EOF) {
			break
		} else if err != nil {
			t.Fatalf("stored record is not JSON: %v", err)
		}
		reports = append(reports, string(record.Report))
	}
	if len(reports) == 0 {
		t.Fatal("no reports on disk")
	}
	return strings.Join(reports, "\n")
}

func TestPublicRoute(t *testing.T) {
	// Which screen, not which room and with whom (#737).
	for route, want := range map[string]string{
		"/ride":                  "/ride",
		"/lounge":                "/lounge",
		"/r/mfw-5":               "/r/…",
		"/r/mfw-5/sessions":      "/r/…/sessions",
		"/messages/dm/u-123":     "/messages/dm/…",
		"/messages/dm/u-123/pin": "/messages/dm/…/pin",
		"/r/":                    "/r/",
	} {
		if got := publicRoute(route); got != want {
			t.Errorf("publicRoute(%q) = %q, want %q", route, got, want)
		}
	}
}

func TestSubmitKeepsTheReporterOutOfThePublicIssue(t *testing.T) {
	// #737: the issue is filed in a public repository. A display name plus
	// the room that rider was in is a disclosure in two halves — and neither
	// half is needed there. Disk keeps both, for triage.
	t.Setenv("WATTROOM_FEEDBACK_DIR", t.TempDir())
	issuer := &captureIssuer{}
	svc := New(fakeSessions{db.User{DisplayName: "velvet"}}, issuer, NewLogRing(slog.DiscardHandler), slog.New(slog.DiscardHandler))
	mux := http.NewServeMux()
	svc.Register(mux)

	// No note and no error, so the title falls back to the route.
	payload := `{"route":"/r/mfw-5/sessions","note":"","firstError":"","clientBuild":"dev",
		"userAgent":"vitest","trainer":"Kickr","clientMs":1700000000000,
		"buffer":{"ticks":[],"events":[],"errors":[]}}`
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/feedback", strings.NewReader(payload)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}

	for name, text := range map[string]string{"title": issuer.title, "body": issuer.body} {
		for _, leaked := range []string{"velvet", "mfw-5"} {
			if strings.Contains(text, leaked) {
				t.Errorf("issue %s carries %q:\n%s", name, leaked, text)
			}
		}
	}
	if !strings.Contains(issuer.body, "/r/…/sessions") {
		t.Errorf("issue body lost the screen it happened on:\n%s", issuer.body)
	}
	// Triage still has both, on disk — the whole record, not the report alone.
	raw, err := os.ReadFile(filepath.Join(svc.dir, "reports.jsonl")) //nolint:gosec // dir is t.TempDir()
	if err != nil {
		t.Fatal(err)
	}
	disk := string(raw)
	for _, want := range []string{"velvet", "mfw-5"} {
		if !strings.Contains(disk, want) {
			t.Errorf("the disk record lost %q:\n%s", want, disk)
		}
	}
}
