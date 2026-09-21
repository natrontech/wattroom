package rooms

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// roomOf is the room row behind a slug, for the tests that write chat the way
// the hub does rather than through an HTTP composer the app has not got.
func (h *harness) roomOf(t *testing.T, slug string) db.Room {
	t.Helper()
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room %s: %v", slug, err)
	}
	return room
}

// walkIn puts someone in the room itself. Joining the crew is not joining the
// room (ADR-0038): an open room is one a crew-mate MAY enter, and the notice
// rides a member's room read.
func (h *harness) walkIn(t *testing.T, who, slug string) {
	t.Helper()
	if status, body := h.call(t, who, http.MethodPost, "/api/rooms/"+slug+"/join", ""); status != http.StatusOK && status != http.StatusNoContent {
		t.Fatalf("%s walking into %s: %d %v", who, slug, status, body)
	}
}

// The room's announcement (ADR-0057, #2408): a chat message a coach marked.
// What is worth testing is the two halves that are not obvious from the
// handlers — that only a coach may mark, and that the marked line survives
// the 500-message cap that is the whole reason a coach marks one.

// say puts a line in the room's log and returns its id. The socket is the
// rider's path to chat, so this writes through the store the way the hub
// does rather than pretending there is an HTTP composer.
func (h *harness) say(t *testing.T, roomID pgtype.UUID, who, text string) string {
	t.Helper()
	id, err := h.store.Queries.SaveChatMessage(t.Context(), db.SaveChatMessageParams{
		RoomID: roomID, UserID: h.users.ByToken[who].ID, Text: text,
		CreatedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		t.Fatalf("%s saying %q: %v", who, text, err)
	}
	return store.UUIDString(id)
}

// announcement is the notice on a member's room read, or "" when none is up.
func (h *harness) announcement(t *testing.T, who, slug string) map[string]any {
	t.Helper()
	status, body := h.call(t, who, http.MethodGet, "/api/rooms/"+slug, "")
	if status != http.StatusOK {
		t.Fatalf("%s reading %s: %d %v", who, slug, status, body)
	}
	put, _ := body["announcement"].(map[string]any)
	return put
}

func TestAnnouncementIsAMarkedMessage(t *testing.T) {
	h := setup(t)
	slug, _ := crewWith(t, h)
	h.walkIn(t, "bob", slug)
	room := h.roomOf(t, slug)
	line := h.say(t, room.ID, "alice", "No session Thursday — I'm away.")

	if put := h.announcement(t, "alice", slug); put != nil {
		t.Fatalf("a new room has no announcement, got %v", put)
	}

	if status, body := h.call(t, "alice", http.MethodPut, "/api/rooms/"+slug+"/announcement",
		fmt.Sprintf(`{"messageId":%q}`, line)); status != http.StatusOK {
		t.Fatalf("alice marking her line: %d %v", status, body)
	}

	// Bob is a plain member and never marked anything: the notice is the
	// room's, and it reaches everyone in it.
	put := h.announcement(t, "bob", slug)
	if put == nil || put["text"] != "No session Thursday — I'm away." {
		t.Fatalf("bob's room read carried no notice: %v", put)
	}
	// The MESSAGE's author, not whoever marked it — a coach putting somebody
	// else's sentence up is quoting them.
	if put["from"] != h.displayName(t, "alice") || put["messageId"] != line {
		t.Fatalf("the notice should name the line and its author: %v", put)
	}

	// One at a time: marking another replaces it rather than stacking.
	second := h.say(t, room.ID, "bob", "Route changed for Saturday.")
	if status, body := h.call(t, "alice", http.MethodPut, "/api/rooms/"+slug+"/announcement",
		fmt.Sprintf(`{"messageId":%q}`, second)); status != http.StatusOK {
		t.Fatalf("marking a second line: %d %v", status, body)
	}
	if put := h.announcement(t, "bob", slug); put == nil || put["messageId"] != second {
		t.Fatalf("the newer mark should have replaced the older: %v", put)
	}

	if status, body := h.call(t, "alice", http.MethodDelete, "/api/rooms/"+slug+"/announcement", ""); status != http.StatusNoContent {
		t.Fatalf("taking it down: %d %v", status, body)
	}
	if put := h.announcement(t, "bob", slug); put != nil {
		t.Fatalf("the notice should be down: %v", put)
	}
	// Taking down a notice a room has not got is the state the caller asked
	// for, not a mistake to report.
	if status, _ := h.call(t, "alice", http.MethodDelete, "/api/rooms/"+slug+"/announcement", ""); status != http.StatusNoContent {
		t.Fatalf("clearing twice should be idempotent, got %d", status)
	}
}

func TestOnlyACoachMarks(t *testing.T) {
	h := setup(t)
	slug, _ := crewWith(t, h)
	h.walkIn(t, "bob", slug)
	room := h.roomOf(t, slug)
	line := h.say(t, room.ID, "bob", "Bringing cake.")
	body := fmt.Sprintf(`{"messageId":%q}`, line)

	// A plain member: 403, not 404 — bob can see the room, so the honest
	// answer is that this is not his to do.
	if status, out := h.call(t, "bob", http.MethodPut, "/api/rooms/"+slug+"/announcement", body); status != http.StatusForbidden {
		t.Fatalf("bob marking: expected 403, got %d %v", status, out)
	}
	if status, out := h.call(t, "bob", http.MethodDelete, "/api/rooms/"+slug+"/announcement", ""); status != http.StatusForbidden {
		t.Fatalf("bob clearing: expected 403, got %d %v", status, out)
	}
	if status, _ := h.call(t, "", http.MethodPut, "/api/rooms/"+slug+"/announcement", body); status != http.StatusUnauthorized {
		t.Fatalf("signed out: expected 401")
	}
	if put := h.announcement(t, "alice", slug); put != nil {
		t.Fatalf("nothing should have been marked: %v", put)
	}

	// A coach may, once the owner makes them one.
	if status, out := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/role",
		fmt.Sprintf(`{"userId":%q,"role":"coach"}`, h.userID(t, "bob"))); status != http.StatusOK && status != http.StatusNoContent {
		t.Fatalf("making bob a coach: %d %v", status, out)
	}
	if status, out := h.call(t, "bob", http.MethodPut, "/api/rooms/"+slug+"/announcement", body); status != http.StatusOK {
		t.Fatalf("coach bob marking: %d %v", status, out)
	}
}

func TestAnnouncementRefusesAnotherRoomsLine(t *testing.T) {
	h := setup(t)
	slug, _ := crewWith(t, h)
	otherSlug, _ := h.createRoom(t, "carol", "Other Room")
	elsewhere := h.say(t, h.roomOf(t, otherSlug).ID, "carol", "Not your line.")

	// Alice runs her room, so the role check passes and the message id is the
	// only thing between her and a sentence she cannot read.
	if status, out := h.call(t, "alice", http.MethodPut, "/api/rooms/"+slug+"/announcement",
		fmt.Sprintf(`{"messageId":%q}`, elsewhere)); status != http.StatusNotFound {
		t.Fatalf("marking another room's line: expected 404, got %d %v", status, out)
	}
	if put := h.announcement(t, "alice", slug); put != nil {
		t.Fatalf("nothing should have been marked: %v", put)
	}
	if status, out := h.call(t, "alice", http.MethodPut, "/api/rooms/"+slug+"/announcement",
		`{"messageId":"not-a-uuid"}`); status != http.StatusBadRequest {
		t.Fatalf("a malformed id: expected 400, got %d %v", status, out)
	}
}

// The cap is the whole reason a coach marks a line rather than leaving it in
// chat, so the prune has to make an exception for it. Without the clause a
// busy week silently takes the notice down — the one thing the mark promises
// will not happen, and nothing anywhere would report it.
func TestPruneKeepsTheAnnouncement(t *testing.T) {
	h := setup(t)
	slug, _ := crewWith(t, h)
	room := h.roomOf(t, slug)
	old := h.say(t, room.ID, "alice", "No session Thursday — I'm away.")
	if status, body := h.call(t, "alice", http.MethodPut, "/api/rooms/"+slug+"/announcement",
		fmt.Sprintf(`{"messageId":%q}`, old)); status != http.StatusOK {
		t.Fatalf("marking: %d %v", status, body)
	}

	// Past the 500-line bound, so the marked line is the oldest thing in the
	// room by a long way and every other rule would drop it.
	for i := range 520 {
		h.say(t, room.ID, "bob", fmt.Sprintf("line %d", i))
	}
	if err := h.store.Queries.PruneChat(context.Background(), room.ID); err != nil {
		t.Fatalf("prune: %v", err)
	}

	if put := h.announcement(t, "alice", slug); put == nil || put["messageId"] != old {
		t.Fatalf("the prune took the announcement with it: %v", put)
	}
	// ...and the cap still holds for everything else: 500 ordinary lines
	// plus the one kept notice.
	rows, err := h.store.Queries.ListRoomChat(context.Background(), db.ListRoomChatParams{
		RoomID: room.ID, Limit: 1000,
	})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 501 {
		t.Fatalf("expected 500 lines plus the kept notice, got %d", len(rows))
	}
}
