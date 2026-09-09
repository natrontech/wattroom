package rooms

import (
	"net/http"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
)

// errors.md asks every endpoint for its 401; the crew surface, the grants and
// the two calendar rotates had none (audit 2026-09-09).
func TestTheCrewSurfaceRefusesTheSignedOut(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Signed Out Room")
	crew := h.crewOf(t, slug)
	id := store.UUIDString(crew.ID)
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatal(err)
	}
	roomID := store.UUIDString(room.ID)
	for _, route := range []struct{ method, path, body string }{
		{http.MethodGet, "/api/crews/" + id, ""},
		{http.MethodPost, "/api/crews/join", `{"code":"ABCDEF"}`},
		{http.MethodPost, "/api/crews/" + id + "/leave", ""},
		{http.MethodPatch, "/api/crews/" + id, `{"name":"x"}`},
		{http.MethodPost, "/api/crews/" + id + "/role", `{"userId":"x","role":"admin"}`},
		{http.MethodPost, "/api/crews/" + id + "/transfer", `{"userId":"x"}`},
		{http.MethodPatch, "/api/crews/" + id + "/rooms/" + roomID + "/access", `{"crewVisible":true}`},
		{http.MethodPost, "/api/crews/" + id + "/image", ""},
		{http.MethodDelete, "/api/crews/" + id + "/image", ""},
		{http.MethodPost, "/api/rooms/" + slug + "/grants", `{"userId":"x"}`},
		{http.MethodDelete, "/api/rooms/" + slug + "/grants/x", ""},
		{http.MethodPost, "/api/rooms/" + slug + "/calendar/rotate", ""},
		{http.MethodPost, "/api/calendar/rotate", ""},
	} {
		if status, _ := h.call(t, "", route.method, route.path, route.body); status != http.StatusUnauthorized {
			t.Errorf("%s %s signed out: %d, want 401", route.method, route.path, status)
		}
	}
}

// A remove that changed nothing is not a 204 (audit 2026-09-09): the query
// declines a banned row on purpose, and nobody was told.
func TestRemovingSomeoneNotInTheRoomIsNotA204(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Remove Nobody Room")
	bob := store.UUIDString(h.users.byToken["bob"].ID)
	if status, body := h.call(t, "alice", http.MethodDelete, "/api/rooms/"+slug+"/members/"+bob, ""); status != http.StatusNotFound {
		t.Fatalf("removing a non-member: %d %v, want 404", status, body)
	}
	h.join(t, "bob", slug)
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/role", `{"userId":"`+bob+`","role":"banned"}`); status != http.StatusNoContent {
		t.Fatalf("ban: %d", status)
	}
	if status, body := h.call(t, "alice", http.MethodDelete, "/api/rooms/"+slug+"/members/"+bob, ""); status != http.StatusNotFound {
		t.Fatalf("removing a banned row: %d %v, want 404 naming Unban", status, body)
	}
}
