package rides

import (
	"bytes"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func cardRequest(t *testing.T, h *harness, user, id string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/rides/"+id+"/card.png", nil)
	if user != "" {
		r.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	h.mux.ServeHTTP(w, r)
	return w
}

func TestCardOwnerGetsAPNG(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 600, 240)
	w := cardRequest(t, h, "alice", id)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if got := w.Header().Get("Content-Type"); got != "image/png" {
		t.Fatalf("content type = %q", got)
	}
	// A rider's whole ride shape: never a shared cache's to keep.
	if got := w.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("cache-control = %q", got)
	}
	// Named the way the FIT download is (#1549), so a folder of them reads.
	if cd := w.Header().Get("Content-Disposition"); !strings.HasSuffix(cd, `-openers.png"`) || !strings.Contains(cd, "wattroom-20") {
		t.Fatalf("card filename: %q", cd)
	}
	img, err := png.Decode(bytes.NewReader(w.Body.Bytes()))
	if err != nil {
		t.Fatalf("decode PNG: %v", err)
	}
	if got := img.Bounds().Size(); got.X != 1080 || got.Y != 1080 {
		t.Fatalf("card is %v, want 1080 square", got)
	}
}

// The card is the ride, so it is the ride's own access rules — the same ones
// the FIT export has, and for the same reason (ADR-0008, ADR-0017).
func TestCardAuthorization(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 600, 240)
	if status, _ := call(t, h.mux, "alice", http.MethodPatch, "/api/rides/"+id, `{"sharedWithFriends":true}`); status != http.StatusOK {
		t.Fatalf("share: %d", status)
	}
	if w := cardRequest(t, h, "", id); w.Code != http.StatusUnauthorized {
		t.Errorf("anonymous = %d", w.Code)
	}
	// Shared with friends is not shared with the world: a card of somebody
	// else's ride reads as absent, never as forbidden.
	if w := cardRequest(t, h, "bob", id); w.Code != http.StatusNotFound {
		t.Errorf("other user = %d", w.Code)
	}
	for _, tc := range []struct {
		name, id string
		want     int
	}{{"invalid", "nope", 400}, {"missing", "00000000-0000-0000-0000-000000000000", 404}} {
		t.Run(tc.name, func(t *testing.T) {
			if w := cardRequest(t, h, "alice", tc.id); w.Code != tc.want {
				t.Errorf("status = %d, want %d", w.Code, tc.want)
			}
		})
	}
}
