package rooms

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
)

// The room changes hands (#1227): owner only, to a member, the old owner
// stays on as a coach, and the new owner's cap binds. Ownership and the
// 'owner' role move together.
func TestTheOwnerHandsTheRoomToAMember(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Room Handover")
	_ = code
	h.join(t, "bob", slug)
	bob := store.UUIDString(h.users.ByToken["bob"].ID)
	carol := store.UUIDString(h.users.ByToken["carol"].ID)
	path := "/api/rooms/" + slug + "/transfer"

	if status, _ := h.call(t, "bob", http.MethodPost, path, fmt.Sprintf(`{"userId":%q}`, bob)); status != http.StatusForbidden {
		t.Errorf("a member handed the room to themselves: %d, want 403", status)
	}
	if status, _ := h.call(t, "alice", http.MethodPost, path, fmt.Sprintf(`{"userId":%q}`, carol)); status != http.StatusBadRequest {
		t.Errorf("the room passed to a non-member: %d, want 400", status)
	}
	if status, _ := h.call(t, "alice", http.MethodPost, path, fmt.Sprintf(`{"userId":%q}`, bob)); status != http.StatusNoContent {
		t.Fatalf("hand-over: %d", status)
	}
	_, asBob := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	if asBob["role"] != "owner" {
		t.Errorf("bob's role is %v, want owner", asBob["role"])
	}
	_, asAlice := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	if asAlice["role"] != "coach" {
		t.Errorf("alice's role is %v, want coach", asAlice["role"])
	}
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil || room.OwnerID != h.users.ByToken["bob"].ID {
		t.Errorf("rooms.owner_id did not move with the role: %v %v", err, room.OwnerID)
	}
	// The old owner's paperwork is gone with the role.
	if status, _ := h.call(t, "alice", http.MethodPost, path, fmt.Sprintf(`{"userId":%q}`, bob)); status != http.StatusForbidden {
		t.Errorf("the old owner still hands the room on: %d, want 403", status)
	}

	// The cap binds the receiver: carol owns three, so bob cannot hand it to her.
	for i := range 3 {
		h.createRoom(t, "carol", fmt.Sprintf("Room Handover Full %d", i))
	}
	h.join(t, "carol", slug)
	if status, _ := h.call(t, "bob", http.MethodPost, path, fmt.Sprintf(`{"userId":%q}`, carol)); status != http.StatusConflict {
		t.Errorf("a room passed to someone at the cap: %d, want 409", status)
	}
}
