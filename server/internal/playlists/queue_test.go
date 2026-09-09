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

	// A tempo the deck can match a block's cadence against (#1431): the bridge
	// dropped it, so a track queued this way was the one the matcher never saw.
	tempo := h.trackBpm(t, "alice", "Tempo", 128)

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

	h.live.tracks = nil
	if code, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/queue",
		`{"trackIds":["`+tempo+`"]}`); code != http.StatusOK {
		t.Fatalf("queue the tempo track: %d", code)
	}
	if len(h.live.tracks) != 1 || h.live.tracks[0].Bpm != 128 {
		t.Fatalf("bpm reaching the bridge: %+v", h.live.tracks)
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
