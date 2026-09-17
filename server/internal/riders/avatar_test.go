package riders

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// A rider's picture (#1353) shows to the audience ADR-0024 gives their page
// and to nobody else (#2239), revalidates by ETag, and a rider without one is
// a 404 — never a broken byte stream.
func TestAvatarServes(t *testing.T) {
	h := setup(t)
	// alice and bob share a room; dan is alice's friend and has no picture.
	h.room(t, "pain-cave", "alice", "bob")
	h.befriend(t, "alice", "dan")
	url := h.avatar(t, "alice")

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
	if w.Code != http.StatusOK || w.Header().Get("Content-Type") != "image/png" || w.Body.String() != avatarPNG {
		t.Fatalf("room-mate fetch: %d %s %q", w.Code, w.Header().Get("Content-Type"), w.Body.String())
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
	if w := fetch("alice", "/api/riders/"+h.id("dan")+"/avatar", ""); w.Code != http.StatusNotFound {
		t.Fatalf("no picture: expected 404, got %d", w.Code)
	}
	if w := fetch("bob", "/api/riders/not-an-id/avatar", ""); w.Code != http.StatusBadRequest {
		t.Fatalf("bad id: expected 400, got %d", w.Code)
	}
}

// The face is not an existence oracle either (#2239). cara shares no room with
// alice and holds no friendship, so what she learns from the picture route has
// to be exactly what she learns from the page and from an id that was never
// issued: a 404 and one sentence. The bytes were the interesting half — before
// the gate, a 200 here told her alice exists and has uploaded a photograph,
// which handleGet goes to some length never to say.
func TestAvatarRefusesLikeThePage(t *testing.T) {
	h := setup(t)
	url := h.avatar(t, "alice")
	const absent = "/api/riders/00000000-0000-0000-0000-000000000000"

	say := func(path string) (int, string) {
		t.Helper()
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
		req.Header.Set("X-Test-User", "cara")
		w := httptest.NewRecorder()
		h.mux.ServeHTTP(w, req)
		var body struct{ Message string }
		_ = json.NewDecoder(w.Body).Decode(&body)
		return w.Code, body.Message
	}

	code, refusal := say(url)
	if code != http.StatusNotFound {
		t.Fatalf("a rider cara may not look up served her their face: %d", code)
	}
	for _, other := range []string{"/api/riders/" + h.id("alice"), absent + "/avatar", absent} {
		if code, message := say(other); code != http.StatusNotFound || message != refusal {
			t.Errorf("%s answered %d %q; the picture answered 404 %q, and a refusal that differs from its neighbours is an oracle",
				other, code, message, refusal)
		}
	}
}
