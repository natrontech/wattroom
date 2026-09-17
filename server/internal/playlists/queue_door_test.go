package playlists

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The queue door is the rooms package's gate now (#2242), not a sixth
// hand-written copy of the ban pair. Delegation is exactly the change that
// can loosen a gate without any test noticing, so every refusal the old copy
// made is asserted here against the new one — including the crew ban, which
// is the level four hand-written joins forgot in #1109 and #1114.
func TestTheQueueDoorStillRefusesEveryoneItDidBefore(t *testing.T) {
	h := setup(t)
	slug := h.room(t, "alice")
	mine := h.track(t, "alice", "One")
	body := `{"trackIds":["` + mine + `"]}`
	queue := func(who, slug string) int {
		t.Helper()
		code, _ := h.call(t, who, http.MethodPost, "/api/rooms/"+slug+"/queue", body)
		return code
	}

	if code := queue("alice", slug); code != http.StatusOK {
		t.Fatalf("the room's own owner was refused: %d — the rest proves nothing", code)
	}
	if code := queue("", slug); code != http.StatusUnauthorized {
		t.Errorf("anonymous: %d, want 401", code)
	}
	if code := queue("bob", slug); code != http.StatusForbidden {
		t.Errorf("not a member: %d, want 403", code)
	}
	if code := queue("alice", "no-room-lives-here"); code != http.StatusNotFound {
		t.Errorf("unknown room: %d, want 404", code)
	}

	h.join(t, slug, "bob", "banned")
	if code := queue("bob", slug); code != http.StatusForbidden {
		t.Errorf("banned from the room: %d, want 403", code)
	}

	// The level above (ADR-0038): carol is a member in good standing of the
	// room and banned by its crew.
	h.join(t, slug, "carol", "member")
	if code := queue("carol", slug); code != http.StatusOK {
		t.Fatalf("a plain member was refused: %d — the crew ban below proves nothing", code)
	}
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}
	crew, err := h.store.Queries.CreateCrew(t.Context(), db.CreateCrewParams{Name: "alice", OwnerID: room.OwnerID})
	if err != nil {
		t.Fatalf("crew: %v", err)
	}
	t.Cleanup(func() { _, _ = h.store.Pool.Exec(context.Background(), "delete from crews where id = $1", crew.ID) })
	if err := h.store.Queries.PlaceRoomInCrew(t.Context(), db.PlaceRoomInCrewParams{
		ID: room.ID, CrewID: crew.ID, CrewVisible: true,
	}); err != nil {
		t.Fatalf("place: %v", err)
	}
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: crew.ID, UserID: h.users["carol"].ID, Role: "banned",
	}); err != nil {
		t.Fatalf("crew ban: %v", err)
	}
	if code := queue("carol", slug); code != http.StatusForbidden {
		t.Errorf("banned by the crew: %d, want 403", code)
	}
}

// A playlist at its ceiling answers like every other ceiling (#2244): 429
// rate_limited, naming the number and the way out. It used to be a 400
// validation_error, which blamed the track being added for a state problem —
// and SPEC:79-81 pins both the status and the wording.
func TestAFullPlaylistRefusesLikeACeiling(t *testing.T) {
	h := setup(t)
	slug := h.room(t, "alice")
	code, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/playlists", `{"name":"Full"}`)
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

	code, body = h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/playlists/"+id+"/tracks", videoTrack)
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
