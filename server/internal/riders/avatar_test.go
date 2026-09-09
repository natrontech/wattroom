package riders

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// A rider's picture (#1353) shows to anyone signed in, revalidates by ETag,
// and a rider without one is a 404 — never a broken byte stream.
func TestAvatarServes(t *testing.T) {
	h := setup(t)
	png := []byte("\x89PNG\r\n\x1a\nrest-of-a-picture")
	setAt := time.Now().Truncate(time.Millisecond)
	url := "/api/riders/" + h.id("alice") + "/avatar"
	if _, err := h.store.Queries.SetUserAvatar(t.Context(), db.SetUserAvatarParams{
		ID: h.users.byToken["alice"].ID, Mime: "image/png", Image: png,
		SetAt: pgtype.Timestamptz{Time: setAt, Valid: true}, AvatarUrl: &url,
	}); err != nil {
		t.Fatal(err)
	}

	fetch := func(viewer, path, ifNoneMatch string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
		if viewer != "" {
			req.Header.Set("X-Test-User", viewer)
		}
		if ifNoneMatch != "" {
			req.Header.Set("If-None-Match", ifNoneMatch)
		}
		w := httptest.NewRecorder()
		h.mux.ServeHTTP(w, req)
		return w
	}

	w := fetch("bob", url, "")
	if w.Code != http.StatusOK || w.Header().Get("Content-Type") != "image/png" || w.Body.String() != string(png) {
		t.Fatalf("stranger fetch: %d %s %q", w.Code, w.Header().Get("Content-Type"), w.Body.String())
	}
	if w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("rider-supplied bytes served without nosniff")
	}
	if w := fetch("bob", url, w.Header().Get("ETag")); w.Code != http.StatusNotModified {
		t.Fatalf("revalidate: expected 304, got %d", w.Code)
	}
	if w := fetch("", url, ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("signed out: expected 401, got %d", w.Code)
	}
	if w := fetch("bob", "/api/riders/"+h.id("dan")+"/avatar", ""); w.Code != http.StatusNotFound {
		t.Fatalf("no picture: expected 404, got %d", w.Code)
	}
	if w := fetch("bob", "/api/riders/not-an-id/avatar", ""); w.Code != http.StatusBadRequest {
		t.Fatalf("bad id: expected 400, got %d", w.Code)
	}
}
