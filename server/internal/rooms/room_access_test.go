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
		CrewID: crew.ID, UserID: h.users.ByToken["carol"].ID, Role: "admin",
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

// The other half of the `admin` state, and the one nothing asserted (#2247):
// a crew admin who never joined a room administers its ACCESS — the route
// above, addressed by id through the crew — and nothing inside the room.
//
// The code is already right: requireRole and RequireModerator read
// memberships and never crew_roles. But crew_access.go shows how easily a
// crew role reaches a room-scoped decision (`administers(role) ||
// room.OwnerID == user.ID`), so a refactor that "unifies" the two role
// systems would take this out with every existing test still green. That is
// the failure this test exists for, which is why it walks the verbs rather
// than one of them.
func TestACrewAdminMayNotModerateARoomTheyNeverJoined(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Crew Admin Gap")
	h.makePrivate(t, slug)
	crew := h.crewOf(t, slug)
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: crew.ID, UserID: h.users.ByToken["carol"].ID, Role: "admin",
	}); err != nil {
		t.Fatalf("admin: %v", err)
	}
	bob := store.UUIDString(h.users.ByToken["bob"].ID)

	// The fixture is only worth anything if carol really is an admin of this
	// room's crew and really is not a member of the room.
	if got := h.accessIn(t, "carol", slug); got != "admin" {
		t.Fatalf("carol reads %q, want admin — the rest proves nothing", got)
	}

	for _, tc := range []struct{ what, method, path, body string }{
		{"rename or relist the room", http.MethodPatch, "/api/rooms/" + slug, `{"name":"Taken Over","listed":true}`},
		{"delete the room", http.MethodDelete, "/api/rooms/" + slug, ""},
		{"hand out a role in it", http.MethodPost, "/api/rooms/" + slug + "/role", `{"userId":"` + bob + `","role":"coach"}`},
		{"let someone in by name", http.MethodPost, "/api/rooms/" + slug + "/grants", `{"userId":"` + bob + `"}`},
		{"take that grant back", http.MethodDelete, "/api/rooms/" + slug + "/grants/" + bob, ""},
	} {
		if status, body := h.call(t, "carol", tc.method, tc.path, tc.body); status != http.StatusForbidden {
			t.Errorf("a crew admin could %s: %d %v, want 403", tc.what, status, body)
		}
	}

	// The room's own read is the outsider view, not the moderator's — and
	// since #2241 it answers only a caller with a session, which carol has.
	status, body := h.call(t, "carol", http.MethodGet, "/api/rooms/"+slug, "")
	if status != http.StatusOK {
		t.Fatalf("a signed-in crew admin cannot read the room at all: %d", status)
	}
	if body["role"] != nil || body["members"] != nil || body["icsToken"] != nil {
		t.Errorf("the outsider view carried a member's fields: %v", body)
	}
	// Nothing above moved: the owner still finds the room they made.
	if _, owner := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, ""); owner["name"] != "Crew Admin Gap" {
		t.Errorf("the room changed after five refusals: %v", owner["name"])
	}
}
