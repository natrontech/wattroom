package playlists

import (
	"net/http"
	"testing"
)

// A refused autoplay save used to change the room anyway (#2248): the three
// writes were not a transaction, so UpdateAutoplay had already committed when
// SetActivePlaylist reported the playlist was not this room's and the handler
// answered 400. The room was left enabled, pointed at whatever had been
// active before — the thing the coach was trying to change.
func TestARefusedAutoplaySaveChangesNothing(t *testing.T) {
	h := setup(t)
	slug := h.room(t, "alice")
	elsewhere := h.room(t, "alice")
	code, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+elsewhere+"/playlists", `{"name":"Not Yours"}`)
	if code != http.StatusCreated {
		t.Fatalf("create playlist: %d %v", code, body)
	}
	theirs, _ := body["id"].(string)

	enabled := func() bool {
		t.Helper()
		code, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug+"/autoplay", "")
		if code != http.StatusOK {
			t.Fatalf("read autoplay: %d %v", code, body)
		}
		on, _ := body["enabled"].(bool)
		return on
	}
	if enabled() {
		t.Fatal("autoplay is on before anything turned it on")
	}

	code, body = h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug+"/autoplay",
		`{"enabled":true,"order":"ordered","activePlaylistId":"`+theirs+`"}`)
	if code != http.StatusBadRequest {
		t.Fatalf("another room's playlist: %d %v, want 400", code, body)
	}
	if enabled() {
		t.Error("a refused save turned autoplay on anyway")
	}

	// And the same request with a playlist this room owns goes through whole.
	code, body = h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/playlists", `{"name":"Ours"}`)
	if code != http.StatusCreated {
		t.Fatalf("create our playlist: %d %v", code, body)
	}
	ours, _ := body["id"].(string)
	if code, body := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug+"/autoplay",
		`{"enabled":true,"order":"ordered","activePlaylistId":"`+ours+`"}`); code != http.StatusOK {
		t.Fatalf("our own playlist: %d %v", code, body)
	}
	if !enabled() {
		t.Error("a save that went through did not turn autoplay on")
	}
}
