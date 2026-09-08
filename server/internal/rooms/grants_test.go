package rooms

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
)

// A grant is the named exception into a private room (ADR-0038, #1224): the
// crew-mate's row turns from locked to enterable, the owner sees them as
// invited until they walk in, and taking it back turns the row locked again.
// Owner only; crew-mates only.
func TestTheOwnerLetsACrewMateIntoAPrivateRoom(t *testing.T) {
	h := setup(t)
	open, _ := h.createRoom(t, "alice", "Crew Grant Open")
	private, _ := h.createRoom(t, "alice", "Crew Grant Private")
	h.makePrivate(t, private)
	h.join(t, "bob", open)
	bob := store.UUIDString(h.users.byToken["bob"].ID)
	carol := store.UUIDString(h.users.byToken["carol"].ID)
	path := "/api/rooms/" + private + "/grants"

	if got := h.accessIn(t, "bob", private); got != "locked" {
		t.Fatalf("before: bob reads %q, want locked", got)
	}
	// The owner's door list names bob as outside, and nobody as invited.
	_, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+private, "")
	if outside, _ := body["crewOutside"].([]any); len(outside) != 1 {
		t.Errorf("the owner sees %d crew-mates outside, want 1 (bob): %v", len(outside), body["crewOutside"])
	}
	if _, has := body["invited"]; has {
		t.Errorf("invited is present before any grant: %v", body["invited"])
	}

	if status, _ := h.call(t, "bob", http.MethodPost, path, fmt.Sprintf(`{"userId":%q}`, carol)); status != http.StatusForbidden {
		t.Errorf("a non-owner granted: %d, want 403", status)
	}
	if status, _ := h.call(t, "alice", http.MethodPost, path, fmt.Sprintf(`{"userId":%q}`, carol)); status != http.StatusBadRequest {
		t.Errorf("a stranger was let in: %d, want 400", status)
	}
	if status, _ := h.call(t, "alice", http.MethodPost, path, fmt.Sprintf(`{"userId":%q}`, bob)); status != http.StatusNoContent {
		t.Fatalf("grant: %d", status)
	}
	if got := h.accessIn(t, "bob", private); got != "private" {
		t.Errorf("granted: bob reads %q, want private (enterable)", got)
	}
	_, body = h.call(t, "alice", http.MethodGet, "/api/rooms/"+private, "")
	if invited, _ := body["invited"].([]any); len(invited) != 1 {
		t.Errorf("the owner sees %d invited, want 1: %v", len(invited), body["invited"])
	}
	if _, has := body["crewOutside"]; has {
		t.Errorf("bob is still listed as outside after the grant: %v", body["crewOutside"])
	}
	// The row the crew-mate gets carries the door now.
	if row := h.listedRow(t, "bob", private); row["slug"] != private {
		t.Errorf("a granted rider is not handed the slug: %v", row)
	}

	if status, _ := h.call(t, "alice", http.MethodDelete, path+"/"+bob, ""); status != http.StatusNoContent {
		t.Fatalf("revoke: %d", status)
	}
	if got := h.accessIn(t, "bob", private); got != "locked" {
		t.Errorf("revoked: bob reads %q, want locked", got)
	}

	// Once they walk in, the grant is moot and they leave the invited list.
	if status, _ := h.call(t, "alice", http.MethodPost, path, fmt.Sprintf(`{"userId":%q}`, bob)); status != http.StatusNoContent {
		t.Fatalf("grant again: %d", status)
	}
	h.join(t, "bob", private)
	_, body = h.call(t, "alice", http.MethodGet, "/api/rooms/"+private, "")
	if _, has := body["invited"]; has {
		t.Errorf("a member is still listed as invited: %v", body["invited"])
	}
}

// A room open to its crew has no exceptions to name — everyone may walk in —
// so the owner's payload carries neither list, and the page draws nothing.
func TestAnOpenRoomNamesNoExceptions(t *testing.T) {
	h := setup(t)
	open, _ := h.createRoom(t, "alice", "Crew Grant Open Only")
	h.join(t, "bob", open)
	_, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+open, "")
	if _, has := body["crewOutside"]; has {
		t.Errorf("an open room lists crew-mates to let in: %v", body["crewOutside"])
	}
}
