package playlists

import (
	"net/http"
	"testing"
)

// Queue several library tracks at once (#1433): the caller's own go on the
// deck in the order given, through the playlist bridge; somebody else's and
// junk are counted as skipped rather than refusing the lot.
func TestQueueTracksAtOnce(t *testing.T) {
	h := setup(t)
	slug := h.room(t, "alice")
	one := h.track(t, "alice", "One")
	two := h.track(t, "alice", "Two")
	bobs := h.track(t, "bob", "Bob's")

	h.live.tracks = nil
	code, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/queue",
		`{"trackIds":["`+one+`","`+bobs+`","not-a-uuid","`+two+`"]}`)
	if code != http.StatusOK || body["queued"] != 2.0 || body["skipped"] != 2.0 {
		t.Fatalf("queue: %d %v", code, body)
	}
	if len(h.live.tracks) != 2 || h.live.tracks[0].TrackID != one || h.live.tracks[1].TrackID != two || h.live.tracks[0].Title != "One" {
		t.Fatalf("what reached the bridge: %+v", h.live.tracks)
	}
	if h.live.slug != slug || h.live.addedBy != "alice" {
		t.Fatalf("bridge addressed %q as %q", h.live.slug, h.live.addedBy)
	}

	if code, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/queue", `{"trackIds":[]}`); code != http.StatusBadRequest {
		t.Fatalf("empty pick: %d", code)
	}
	if code, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/queue", `{"trackIds":["`+bobs+`"]}`); code != http.StatusForbidden {
		t.Fatalf("not a member: %d", code)
	}
	if code, _ := h.call(t, "", http.MethodPost, "/api/rooms/"+slug+"/queue", `{"trackIds":["`+one+`"]}`); code != http.StatusUnauthorized {
		t.Fatalf("anonymous: %d", code)
	}
	h.live.ok = false
	if code, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/queue", `{"trackIds":["`+one+`"]}`); code != http.StatusConflict {
		t.Fatalf("room not live: %d", code)
	}
}
