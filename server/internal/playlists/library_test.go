package playlists

import (
	"net/http"
	"testing"
)

// A saved playlist holds a library track beside its videos (ADR-0045, #1426):
// the entry points at the track, reads its current title and artist, replays
// as a library add, and leaves with the file.
func TestPlaylistHoldsALibraryTrack(t *testing.T) {
	h := setup(t)
	track := h.track(t, "alice", "Sandstorm")
	_, body := h.call(t, "alice", http.MethodPost, "/api/playlists", `{"name":"Mixed"}`)
	id, _ := body["id"].(string)

	status, body := h.call(t, "alice", http.MethodPost, "/api/playlists/"+id+"/tracks", videoTrack)
	if status != http.StatusCreated {
		t.Fatalf("add video: %d %v", status, body)
	}
	status, body = h.call(t, "alice", http.MethodPost, "/api/playlists/"+id+"/tracks", `{"action":"add","trackId":"`+track+`"}`)
	if status != http.StatusCreated {
		t.Fatalf("add library track: %d %v", status, body)
	}
	if body["trackId"] != track || body["title"] != "Sandstorm" || body["artist"] != "Artist of Sandstorm" || body["videoId"] != "" {
		t.Fatalf("library entry shape: %v", body)
	}

	// A track the caller cannot see is absent, not forbidden — and never saved.
	bobs := h.track(t, "bob", "Bob's Own")
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/playlists/"+id+"/tracks", `{"action":"add","trackId":"`+bobs+`"}`); status != http.StatusBadRequest {
		t.Fatalf("somebody else's track: %d, want 400", status)
	}
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/playlists/"+id+"/tracks", `{"action":"add","trackId":"not-a-uuid"}`); status != http.StatusBadRequest {
		t.Fatalf("junk track id: %d, want 400", status)
	}

	// The row says what the library says today: a retitle on the Music page
	// shows in the playlist without touching it.
	if _, err := h.store.Pool.Exec(t.Context(), "update tracks set title = 'Sandstorm (Radio Edit)' where id = $1", track); err != nil {
		t.Fatalf("retitle: %v", err)
	}
	status, body = h.call(t, "alice", http.MethodGet, "/api/playlists/"+id, "")
	tracks, _ := body["tracks"].([]any)
	if status != http.StatusOK || len(tracks) != 2 {
		t.Fatalf("detail: %d %v", status, body)
	}
	second, _ := tracks[1].(map[string]any)
	if second["trackId"] != track || second["title"] != "Sandstorm (Radio Edit)" {
		t.Fatalf("library row after retitle: %v", second)
	}

	// Queued into a room, the entry replays as the library add the Music page
	// sends, in saved order.
	slug := h.room(t, "alice")
	h.live.tracks = nil
	if status, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/playlists/"+id+"/queue", ""); status != http.StatusOK {
		t.Fatalf("queue: %d %v", status, body)
	}
	if len(h.live.tracks) != 2 || h.live.tracks[0].VideoID != "dQw4w9WgXcQ" || h.live.tracks[1].TrackID != track || h.live.tracks[1].VideoID != "" {
		t.Fatalf("replayed commands: %+v", h.live.tracks)
	}
	if h.live.tracks[1].Title != "Sandstorm (Radio Edit)" || h.live.tracks[1].Artist != "Artist of Sandstorm" {
		t.Fatalf("library add carries the track's own title and artist: %+v", h.live.tracks[1])
	}

	// A deleted MP3 leaves every playlist — the cascade is the behaviour
	// wanted, and the reason one table beat two (#655).
	if _, err := h.store.Pool.Exec(t.Context(), "delete from tracks where id = $1", track); err != nil {
		t.Fatalf("delete track: %v", err)
	}
	_, body = h.call(t, "alice", http.MethodGet, "/api/playlists/"+id, "")
	if tracks, _ := body["tracks"].([]any); len(tracks) != 1 {
		t.Fatalf("after the file went: %v", body)
	}
}
