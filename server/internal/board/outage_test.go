package board

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/httpx"
)

// A clip lookup that fails is not a clip that is gone (#2242, the rule
// #1984 set). The owner of a clip that is sitting right there was told "No
// such clip" whenever the pool timed out or the connection reset, and
// httpx.Fail was skipped so nothing was logged either — the failure the
// operator most needs to see was the one that left no trace.
//
// An expired request deadline is a database error that is not pgx.ErrNoRows,
// which is exactly the distinction the handlers now make. (A cancelled one is
// the rider leaving, which httpx.Fail keeps quiet — #2538.)
func TestADatabaseFailureIsNotAMissingClip(t *testing.T) {
	mux, _, _ := setup(t)
	clip := upload(t, mux, "alice", "AIRHORN", tenSeconds())

	for _, tc := range []struct {
		what   string
		method string
		path   string
		body   []byte
	}{
		{"meta", http.MethodGet, "/api/board/clips/" + clip.ID, nil},
		{"audio", http.MethodGet, "/api/board/clips/" + clip.ID + "/audio", nil},
		{"edit", http.MethodPut, "/api/board/clips/" + clip.ID + "/edit", []byte(`{"startMs":0,"endMs":0,"gainDb":0,"fadeInMs":0,"fadeOutMs":0}`)},
	} {
		t.Run(tc.what, func(t *testing.T) {
			ctx, cancel := context.WithDeadline(t.Context(), time.Now())
			defer cancel()
			req := httptest.NewRequestWithContext(ctx, tc.method, tc.path, bytes.NewReader(tc.body))
			req.Header.Set("X-Test-User", "alice")
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)

			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("status %d, want 500: %s", rec.Code, rec.Body)
			}
			var body httpx.ErrorResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("not the error shape: %v: %s", err, rec.Body)
			}
			if body.Error != "internal_error" || body.Message == "" {
				t.Fatalf("body %+v, want internal_error with a message", body)
			}
		})
	}
}
