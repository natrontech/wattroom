package playlists

import (
	"context"
	"net/http"
	"testing"

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
