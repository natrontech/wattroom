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

// The buffer's strings are rider-controlled too (#2238), and they go into the
// same public issue. Not reachable today — json.Marshal escapes newlines, so
// the block is one line, and a Markdown fence closes only at the start of one
// — but the block's integrity should not rest on how we happen to serialise
// it, so the buffer is neutralised like every other rider-supplied value.
func TestTheRecordersBufferCarriesNoFenceIntoItsBlock(t *testing.T) {
	body := issueBody("abc", Report{
		Route: "/ride",
		Buffer: Buffer{Events: []BufferEvent{{
			At:   1,
			Kind: "note",
			Text: "``` ![x](https://evil/x.png)",
		}}},
	})
	open := strings.Index(body, "```json\n")
	if open < 0 {
		t.Fatalf("no buffer block at all:\n%s", body)
	}
	inside := body[open+len("```json\n"):]
	closed := strings.Index(inside, "\n```")
	if closed < 0 {
		t.Fatalf("the buffer block never closes:\n%s", body)
	}
	if strings.Contains(inside[:closed], "```") {
		t.Fatalf("the buffer carries a fence into the block: %s", inside[:closed])
	}
}

// The six scalars were bounded and the buffer was not, so the only ceiling on
// it was the 512 KB body — past which GitHub refuses the issue and the rider
// is told nothing (#2238).
func TestABufferPastItsCeilingIsRefused(t *testing.T) {
	for _, tc := range []struct {
		name   string
		buffer Buffer
	}{
		{"too many ticks", Buffer{Ticks: make([]Tick, maxBufferTicks+1)}},
		{"too many events", Buffer{Events: make([]BufferEvent, maxBufferEvents+1)}},
		{"too many errors", Buffer{Errors: make([]BufferError, maxBufferErrors+1)}},
		{"a long event", Buffer{Events: []BufferEvent{{Text: strings.Repeat("x", maxBufferText+1)}}}},
		{"a long error", Buffer{Errors: []BufferError{{Text: strings.Repeat("x", maxBufferText+1)}}}},
		{"a long state", Buffer{Ticks: []Tick{{State: strings.Repeat("x", maxBufferText+1)}}}},
	} {
		if boundedBuffer(tc.buffer) {
			t.Errorf("%s was accepted", tc.name)
		}
	}
	// And what the recorder really produces is not refused.
	ok := Buffer{
		Ticks:  make([]Tick, 120),
		Events: []BufferEvent{{Kind: "pause", Text: "rider paused"}},
		Errors: []BufferError{{Text: "trainer dropped"}},
	}
	if !boundedBuffer(ok) {
		t.Fatal("two minutes of the real ring was refused")
	}
}
