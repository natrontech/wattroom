package playlists

import (
	"net/http"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The queue door is the voice channel's gate (#2439, ADR-0058), not a
// hand-written copy of it. Delegation is exactly the change that can loosen a
// gate without any test noticing, so every refusal the room's door made is
// asserted here against the channel's — including the crew ban, the level
// four hand-written joins forgot in #1109 and #1114. A channel the caller
// may not enter is a 404 like one that is not there: a private channel's
// existence is part of what its gate keeps.
func TestTheQueueDoorStillRefusesEveryoneItDidBefore(t *testing.T) {
	h := setup(t)
	c := h.crew(t, "alice")
	mine := h.track(t, "alice", "One")
	body := `{"trackIds":["` + mine + `"]}`
	queue := func(who, channel string) int {
		t.Helper()
		code, _ := h.call(t, who, http.MethodPost, "/api/channels/"+channel+"/queue", body)
		return code
	}

	if code := queue("alice", c.voice()); code != http.StatusOK {
		t.Fatalf("the crew's own owner was refused: %d — the rest proves nothing", code)
	}
	if code := queue("", c.voice()); code != http.StatusUnauthorized {
		t.Errorf("anonymous: %d, want 401", code)
	}
	if code := queue("bob", c.voice()); code != http.StatusNotFound {
		t.Errorf("not in the crew: %d, want 404", code)
	}
	if code := queue("alice", "00000000-0000-0000-0000-000000000000"); code != http.StatusNotFound {
		t.Errorf("unknown channel: %d, want 404", code)
	}

	// A member the private channel does not name — the successor of a rider
	// the room never let in.
	if err := h.store.Queries.JoinCrew(t.Context(), db.JoinCrewParams{CrewID: c.id, UserID: h.users["bob"].ID}); err != nil {
		t.Fatalf("join: %v", err)
	}
	if code := queue("bob", c.voice()); code != http.StatusNotFound {
		t.Errorf("a member not named into the private channel: %d, want 404", code)
	}

	// The level above: carol is named into the channel and banned by its crew.
	h.join(t, c, "carol", "member")
	if code := queue("carol", c.voice()); code != http.StatusOK {
		t.Fatalf("a named member was refused: %d — the crew ban below proves nothing", code)
	}
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: c.id, UserID: h.users["carol"].ID, Role: "banned",
	}); err != nil {
		t.Fatalf("crew ban: %v", err)
	}
	if code := queue("carol", c.voice()); code != http.StatusNotFound {
		t.Errorf("banned by the crew: %d, want 404", code)
	}
}

// A playlist at its ceiling answers like every other ceiling (#2244): 429
// rate_limited, naming the number and the way out. It used to be a 400
// validation_error, which blamed the track being added for a state problem —
// and SPEC:79-81 pins both the status and the wording.
func TestAFullPlaylistRefusesLikeACeiling(t *testing.T) {
	h := setup(t)
	base := "/api/crews/" + store.UUIDString(h.crew(t, "alice").id) + "/playlists"
	code, body := h.call(t, "alice", http.MethodPost, base, `{"name":"Full"}`)
	if code != http.StatusCreated {
		t.Fatalf("create playlist: %d %v", code, body)
	}
	id, _ := body["id"].(string)
	pid, err := store.ParseUUID(id)
	if err != nil {
		t.Fatalf("playlist id %q: %v", id, err)
	}
	// One row at the last position stands the playlist at its ceiling: the
	// next position is what the door reads, not the row count.
	if _, err := h.store.Queries.InsertPlaylistTrack(t.Context(), db.InsertPlaylistTrackParams{
		PlaylistID: pid, Position: maxSavedTracks - 1, VideoID: "dQw4w9WgXcQ", Title: "The Last One",
		Tracks: []byte("[]"),
	}); err != nil {
		t.Fatalf("seed the last slot: %v", err)
	}

	code, body = h.call(t, "alice", http.MethodPost, base+"/"+id+"/tracks", videoTrack)
	if code != http.StatusTooManyRequests {
		t.Fatalf("adding to a full playlist: %d %v, want 429", code, body)
	}
	if body["error"] != "rate_limited" {
		t.Errorf("code %v, want rate_limited", body["error"])
	}
	msg, _ := body["message"].(string)
	if !strings.Contains(msg, "300") || !strings.Contains(msg, "Remove") {
		t.Errorf("the refusal names neither the number nor the way out: %q", msg)
	}
}
