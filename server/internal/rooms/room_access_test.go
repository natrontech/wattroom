package rooms

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The `admin` access state finally does something (#1226): a crew admin who
// never joined a room opens it to the crew or shuts it, by id — the row
// carries no slug for them (#1205) — and nothing else about the room moves.
func TestACrewAdminOpensARoomToTheCrewWithoutEnteringIt(t *testing.T) {
	h := setup(t)
	open, _ := h.createRoom(t, "alice", "Crew Access Open")
	private, _ := h.createRoom(t, "alice", "Crew Access Private")
	h.makePrivate(t, private)
	crew := h.crewOf(t, open)
	h.join(t, "bob", open)
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: crew.ID, UserID: h.users.byToken["carol"].ID, Role: "admin",
	}); err != nil {
		t.Fatalf("admin: %v", err)
	}
	path := fmt.Sprintf("/api/crews/%s/rooms/%s/access", store.UUIDString(crew.ID), store.UUIDString(roomID(t, h, private)))

	if got := h.accessIn(t, "carol", private); got != "admin" {
		t.Fatalf("before: carol reads %q, want admin", got)
	}
	if status, _ := h.call(t, "bob", http.MethodPatch, path, `{"crewVisible":true}`); status != http.StatusForbidden {
		t.Errorf("a plain member opened the room: %d, want 403", status)
	}
	if status, _ := h.call(t, "carol", http.MethodPatch, path, `{"crewVisible":true}`); status != http.StatusNoContent {
		t.Fatalf("a crew admin could not open the room: %d", status)
	}
	if got := h.accessIn(t, "bob", private); got != "open" {
		t.Errorf("opened by an admin: bob reads %q, want open", got)
	}
	// Opening it admits the crew, and carol's admin row IS crew membership
	// (#1236), so the room she could only administer is now hers to enter.
	// The room's own name is untouched.
	if got := h.accessIn(t, "carol", private); got != "open" {
		t.Errorf("carol reads %q after opening it, want open", got)
	}
	_, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+private, "")
	if body["name"] != "Crew Access Private" || body["crewVisible"] != true {
		t.Errorf("the room changed in ways it should not have: %v", body)
	}
	if status, _ := h.call(t, "carol", http.MethodPatch, path, `{"crewVisible":false}`); status != http.StatusNoContent {
		t.Fatalf("shut: %d", status)
	}
	if got := h.accessIn(t, "bob", private); got != "locked" {
		t.Errorf("shut by an admin: bob reads %q, want locked", got)
	}
	// A room of another crew is not reachable through this crew.
	other, _ := h.createRoom(t, "carol", "Crew Access Elsewhere")
	elsewhere := fmt.Sprintf("/api/crews/%s/rooms/%s/access", store.UUIDString(crew.ID), store.UUIDString(roomID(t, h, other)))
	if status, _ := h.call(t, "carol", http.MethodPatch, elsewhere, `{"crewVisible":true}`); status != http.StatusNotFound {
		t.Errorf("a room outside the crew was addressed through it: %d, want 404", status)
	}
}
