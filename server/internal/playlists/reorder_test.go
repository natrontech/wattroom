package playlists

import (
	"net/http"
	"testing"
)

// Reorder (#1428): the moved entry lands at the index, the rest keep their
// order, an index past the end lands last, and somebody else's playlist is
// absent rather than forbidden — like every other verb on the shelf.
func TestPlaylistReorder(t *testing.T) {
	h := setup(t)
	_, body := h.call(t, "alice", http.MethodPost, "/api/playlists", `{"name":"In order"}`)
	id, _ := body["id"].(string)
	var ids []string
	for _, video := range []string{"dQw4w9WgXcQ", "9bZkp7q19f0", "kJQP7kiw5Fk"} {
		_, row := h.call(t, "alice", http.MethodPost, "/api/playlists/"+id+"/tracks", `{"action":"add","videoId":"`+video+`","title":"`+video+`"}`)
		rowID, _ := row["id"].(string)
		ids = append(ids, rowID)
	}
	order := func() []string {
		t.Helper()
		_, body := h.call(t, "alice", http.MethodGet, "/api/playlists/"+id, "")
		tracks, _ := body["tracks"].([]any)
		out := make([]string, 0, len(tracks))
		for _, tr := range tracks {
			m, _ := tr.(map[string]any)
			s, _ := m["id"].(string)
			out = append(out, s)
		}
		return out
	}
	equal := func(got, want []string) bool {
		if len(got) != len(want) {
			return false
		}
		for i := range got {
			if got[i] != want[i] {
				return false
			}
		}
		return true
	}

	if code, _ := h.call(t, "alice", http.MethodPut, "/api/playlists/"+id+"/tracks/"+ids[2]+"/position", `{"index":0}`); code != http.StatusNoContent {
		t.Fatalf("move last to first: %d", code)
	}
	if got := order(); !equal(got, []string{ids[2], ids[0], ids[1]}) {
		t.Fatalf("after moving the last to the front: %v", got)
	}
	if code, _ := h.call(t, "alice", http.MethodPut, "/api/playlists/"+id+"/tracks/"+ids[2]+"/position", `{"index":99}`); code != http.StatusNoContent {
		t.Fatalf("move past the end: %d", code)
	}
	if got := order(); !equal(got, []string{ids[0], ids[1], ids[2]}) {
		t.Fatalf("past the end lands last: %v", got)
	}
	if code, _ := h.call(t, "alice", http.MethodPut, "/api/playlists/"+id+"/tracks/"+ids[1]+"/position", `{"index":-5}`); code != http.StatusNoContent {
		t.Fatalf("move before the start: %d", code)
	}
	if got := order(); !equal(got, []string{ids[1], ids[0], ids[2]}) {
		t.Fatalf("before the start lands first: %v", got)
	}
	if code, _ := h.call(t, "alice", http.MethodPut, "/api/playlists/"+id+"/tracks/"+ids[0]+"/position", `{"index":"one"}`); code != http.StatusBadRequest {
		t.Fatalf("junk body: %d", code)
	}
	if code, _ := h.call(t, "alice", http.MethodPut, "/api/playlists/"+id+"/tracks/00000000-0000-0000-0000-000000000000/position", `{"index":0}`); code != http.StatusNotFound {
		t.Fatalf("unknown track: %d", code)
	}
	if code, _ := h.call(t, "bob", http.MethodPut, "/api/playlists/"+id+"/tracks/"+ids[0]+"/position", `{"index":0}`); code != http.StatusNotFound {
		t.Fatalf("somebody else's playlist: %d", code)
	}
	if code, _ := h.call(t, "", http.MethodPut, "/api/playlists/"+id+"/tracks/"+ids[0]+"/position", `{"index":0}`); code != http.StatusUnauthorized {
		t.Fatalf("anonymous: %d", code)
	}
}

// A member reorders a room's playlist, and a non-member does not (#2248).
// #695 moved the verbs that take something off the room's shelf to the coach
// and the owner and left the ones that put something on it with the member;
// reordering does neither, and docs/SPEC.md now says which side it is on.
func TestAMemberReordersARoomPlaylist(t *testing.T) {
	h := setup(t)
	slug := h.room(t, "alice")
	h.join(t, slug, "bob", "member")
	_, created := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/playlists", `{"name":"Shared set"}`)
	id, _ := created["id"].(string)
	var ids []string
	for _, video := range []string{"dQw4w9WgXcQ", "9bZkp7q19f0"} {
		_, row := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/playlists/"+id+"/tracks",
			`{"action":"add","videoId":"`+video+`","title":"`+video+`"}`)
		rowID, _ := row["id"].(string)
		ids = append(ids, rowID)
	}

	if code, body := h.call(t, "bob", http.MethodPut,
		"/api/rooms/"+slug+"/playlists/"+id+"/tracks/"+ids[1]+"/position", `{"index":0}`); code != http.StatusNoContent {
		t.Fatalf("member reorder: %d %v, want 204", code, body)
	}
	_, read := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug+"/playlists/"+id, "")
	tracks, _ := read["tracks"].([]any)
	if len(tracks) != 2 {
		t.Fatalf("read back: %v", read)
	}
	if first, _ := tracks[0].(map[string]any); first["id"] != ids[1] {
		t.Fatalf("the move did not take: %v", tracks)
	}

	// Membership is still the gate: a room playlist is not the caller's own,
	// so a rider who never joined is a stranger to it.
	if code, _ := h.call(t, "carol", http.MethodPut,
		"/api/rooms/"+slug+"/playlists/"+id+"/tracks/"+ids[0]+"/position", `{"index":0}`); code != http.StatusForbidden {
		t.Fatalf("non-member reorder: %d, want 403", code)
	}
}
