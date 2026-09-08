package rooms

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
)

// The smallest bytes http.DetectContentType calls a PNG.
const tinyPNG = "\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"

// A crew's logo (#1237): owner and admins set and clear it, its people read
// it by id, whoever holds the code reads it at the door, and every payload
// that names the crew says whether one is there.
func TestTheCrewWearsItsPicture(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Crew Picture Room")
	crew := h.crewOf(t, slug)
	h.join(t, "bob", slug)
	id := store.UUIDString(crew.ID)
	path := "/api/crews/" + id + "/image"

	if status, _ := h.call(t, "bob", http.MethodPost, path, tinyPNG); status != http.StatusForbidden {
		t.Errorf("a member set the picture: %d, want 403", status)
	}
	if status, _ := h.call(t, "alice", http.MethodGet, path, ""); status != http.StatusNotFound {
		t.Errorf("a crew with no picture served one: %d, want 404", status)
	}
	if status, _ := h.call(t, "alice", http.MethodPost, path, "not an image at all"); status != http.StatusBadRequest {
		t.Errorf("text was accepted as a picture: %d, want 400", status)
	}
	status, body := h.call(t, "alice", http.MethodPost, path, tinyPNG)
	if status != http.StatusOK || body["imageUrl"] != path {
		t.Fatalf("set picture: %d %v", status, body)
	}
	// Payloads say so: the crew page, and the room list's crew.
	if _, crewBody := h.call(t, "bob", http.MethodGet, "/api/crews/"+id, ""); crewBody["imageUrl"] != path {
		t.Errorf("the crew payload does not carry the picture: %v", crewBody["imageUrl"])
	}
	if crewRow, _ := h.listedRow(t, "bob", slug)["crew"].(map[string]any); crewRow["imageUrl"] != path {
		t.Errorf("the room list's crew does not carry the picture: %v", crewRow)
	}
	// Served to a member with its type, and to the door by code.
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	req.Header.Set("X-Test-User", "bob")
	w := httptest.NewRecorder()
	h.mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK || w.Header().Get("Content-Type") != "image/png" || !strings.HasPrefix(w.Body.String(), "\x89PNG") {
		t.Errorf("member read: %d %s", w.Code, w.Header().Get("Content-Type"))
	}
	etag := w.Header().Get("ETag")
	req = httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	req.Header.Set("X-Test-User", "bob")
	req.Header.Set("If-None-Match", etag)
	w = httptest.NewRecorder()
	h.mux.ServeHTTP(w, req)
	if w.Code != http.StatusNotModified {
		t.Errorf("a matching ETag was served again: %d", w.Code)
	}
	if status, _ := h.call(t, "carol", http.MethodGet, path, ""); status != http.StatusNotFound {
		t.Errorf("a stranger read the picture by id: %d, want 404", status)
	}
	req = httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/crew-doors/"+code+"/image", nil)
	req.Header.Set("X-Test-User", "carol")
	w = httptest.NewRecorder()
	h.mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("the door does not show the picture to someone holding the code: %d", w.Code)
	}
	_, door := h.call(t, "carol", http.MethodGet, "/api/crew-doors/"+code, "")
	if door["imageUrl"] != "/api/crew-doors/"+code+"/image" {
		t.Errorf("the door payload does not name the picture: %v", door["imageUrl"])
	}

	if status, _ := h.call(t, "alice", http.MethodDelete, path, ""); status != http.StatusNoContent {
		t.Fatalf("clear: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodGet, path, ""); status != http.StatusNotFound {
		t.Errorf("a cleared picture is still served: %d", status)
	}
	if _, crewBody := h.call(t, "bob", http.MethodGet, "/api/crews/"+id, ""); crewBody["imageUrl"] != nil {
		t.Errorf("the crew payload still names a cleared picture: %v", crewBody["imageUrl"])
	}
}
