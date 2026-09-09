package feedback

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// A session source that can also say no.
type gate struct{ user *db.User }

func (g *gate) RequireUser(w http.ResponseWriter, _ *http.Request, msg string) (db.User, bool) {
	if g.user == nil {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", msg)
		return db.User{}, false
	}
	return *g.user, true
}

// The flood guard is keyed on the id, the 429 carries rate_limited, and the
// signed-out get a 401 (audit 2026-09-09).
func TestSubmitRefusesTheSignedOutAndTheFlood(t *testing.T) {
	t.Setenv("WATTROOM_FEEDBACK_DIR", t.TempDir())
	g := &gate{}
	svc := New(g, &captureIssuer{}, NewLogRing(slog.DiscardHandler), slog.New(slog.DiscardHandler))
	mux := http.NewServeMux()
	svc.Register(mux)
	payload := `{"route":"/ride","note":"x","firstError":"","clientBuild":"dev","userAgent":"vitest","trainer":"Kickr","clientMs":1,"buffer":{"ticks":[],"events":[],"errors":[]}}`
	post := func() *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/feedback", strings.NewReader(payload)))
		return rec
	}
	if rec := post(); rec.Code != http.StatusUnauthorized {
		t.Fatalf("signed out: %d", rec.Code)
	}
	id := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	g.user = &db.User{ID: id, DisplayName: "velvet"}
	if rec := post(); rec.Code != http.StatusOK {
		t.Fatalf("first flag: %d %s", rec.Code, rec.Body.String())
	}
	rec := post()
	if rec.Code != http.StatusTooManyRequests || !strings.Contains(rec.Body.String(), `"rate_limited"`) {
		t.Fatalf("second flag inside the window: %d %s, want 429 rate_limited", rec.Code, rec.Body.String())
	}
	// A rename is not a new bucket.
	g.user = &db.User{ID: id, DisplayName: "someone else"}
	if rec := post(); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("renamed inside the window: %d, want 429", rec.Code)
	}
}

// What a rider types never becomes Markdown on the public tracker.
func TestIssueBodyFencesTheRidersFields(t *testing.T) {
	body := issueBody("abc", Report{
		Route: "/ride", ClientBuild: "dev`", UserAgent: "![x](https://evil/x.png)",
		Trainer: "Kickr", Note: "see ![pic](https://evil/y.png) and ```code```",
	})
	for _, raw := range []string{"![x](https://evil/x.png)\n", "`dev``"} {
		if strings.Contains(body, raw) {
			t.Fatalf("issue body carries %q unfenced:\n%s", raw, body)
		}
	}
	if !strings.Contains(body, "```text\n") {
		t.Fatalf("the note is not in a code block:\n%s", body)
	}
}
