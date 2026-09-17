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
	bob := store.UUIDString(h.users.ByToken["bob"].ID)
	carol := store.UUIDString(h.users.ByToken["carol"].ID)
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

// #2294 settled the asymmetry ADR-0038 left: a crew admin who may open a
// private room to the WHOLE crew (#1226) may also name one crew-mate through
// its door, which is the smaller of the two moves. Create and revoke both,
// since a door you can hand out and not take back is worse than neither.
func TestACrewAdminLetsOneCrewMateThroughAPrivateDoor(t *testing.T) {
	h := setup(t)
	open, _ := h.createRoom(t, "alice", "Crew Door Open")
	private, _ := h.createRoom(t, "alice", "Crew Door Private")
	h.makePrivate(t, private)
	crew := h.crewOf(t, private)
	h.join(t, "bob", open) // in the crew, in neither private room
	h.makeCrewAdmin(t, crew, "carol")
	bob, carol := h.userID(t, "bob"), h.userID(t, "carol")
	path := "/api/rooms/" + private + "/grants"

	// The fixture is only worth anything if carol administers this room's
	// crew and has never been in the room.
	if got := h.accessIn(t, "carol", private); got != "admin" {
		t.Fatalf("carol reads %q, want admin — the rest proves nothing", got)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, path, fmt.Sprintf(`{"userId":%q}`, carol)); status != http.StatusForbidden {
		t.Errorf("a plain crew member let someone in: %d, want 403", status)
	}
	if status, body := h.call(t, "carol", http.MethodPost, path, fmt.Sprintf(`{"userId":%q}`, bob)); status != http.StatusNoContent {
		t.Fatalf("a crew admin could not let a crew-mate in: %d %v", status, body)
	}
	if got := h.accessIn(t, "bob", private); got != "private" {
		t.Errorf("let in by a crew admin: bob reads %q, want private (enterable)", got)
	}
	// The door she keeps is not a window (ADR-0038: a crew admin who has not
	// joined a room "may not read its contents"). The door list rides the
	// room's own read, so from outside she gets the outsider view and no
	// roster — the widened verb reaches nothing the read does not.
	_, outsider := h.call(t, "carol", http.MethodGet, "/api/rooms/"+private, "")
	if outsider["members"] != nil || outsider["invited"] != nil || outsider["crewOutside"] != nil {
		t.Errorf("a crew admin outside the room read into it: %v", outsider)
	}
	// The room's owner sees the door somebody else opened.
	_, owner := h.call(t, "alice", http.MethodGet, "/api/rooms/"+private, "")
	if invited, _ := owner["invited"].([]any); len(invited) != 1 {
		t.Errorf("the owner sees %d invited after the admin's grant, want 1: %v", len(invited), owner["invited"])
	}
	if status, _ := h.call(t, "carol", http.MethodDelete, path+"/"+bob, ""); status != http.StatusNoContent {
		t.Fatalf("a crew admin could not take the door back: %d", status)
	}
	if got := h.accessIn(t, "bob", private); got != "locked" {
		t.Errorf("taken back: bob reads %q, want locked", got)
	}
}

// Create, revoke and the door LIST answer one question (#2294), so the crew
// admin who may hand a door out reads the list the buttons are drawn from —
// once they are in the room, which is the only place that list is served.
// A widened verb with an owner-only list would have been a Members page with
// no controls on it.
func TestTheDoorListIsTheDoorkeepersNotTheOwners(t *testing.T) {
	h := setup(t)
	open, _ := h.createRoom(t, "alice", "Door List Open")
	private, _ := h.createRoom(t, "alice", "Door List Private")
	h.makePrivate(t, private)
	crew := h.crewOf(t, private)
	h.join(t, "bob", open)
	h.makeCrewAdmin(t, crew, "carol")
	carol := h.userID(t, "carol")
	path := "/api/rooms/" + private + "/grants"

	// She lets herself in and walks in: a member of the room, still an admin
	// of its crew.
	if status, _ := h.call(t, "carol", http.MethodPost, path, fmt.Sprintf(`{"userId":%q}`, carol)); status != http.StatusNoContent {
		t.Fatalf("a crew admin could not let herself in: %d", status)
	}
	if status, _ := h.call(t, "carol", http.MethodPost, "/api/rooms/"+private+"/join", ""); status != http.StatusNoContent {
		t.Fatalf("join: %d", status)
	}
	_, body := h.call(t, "carol", http.MethodGet, "/api/rooms/"+private, "")
	if body["role"] != "member" {
		t.Fatalf("carol is %v in the room, want member — the rest proves nothing", body["role"])
	}
	// bob is the one name outside: the crew's open room is one carol may
	// enter, which is what puts him in her view of the crew (#1135).
	outside, _ := body["crewOutside"].([]any)
	if len(outside) != 1 {
		t.Fatalf("the crew admin in the room sees %d crew-mates outside, want 1 (bob): %v", len(outside), body["crewOutside"])
	}
	if first, _ := outside[0].(map[string]any); first["id"] != h.userID(t, "bob") {
		t.Errorf("the one name outside is %v, want bob", first)
	}
	// A plain member of the same room gets no door list, and no buttons.
	if status, _ := h.call(t, "carol", http.MethodPost, path, fmt.Sprintf(`{"userId":%q}`, h.userID(t, "bob"))); status != http.StatusNoContent {
		t.Fatalf("grant bob: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+private+"/join", ""); status != http.StatusNoContent {
		t.Fatalf("bob joins: %d", status)
	}
	_, plain := h.call(t, "bob", http.MethodGet, "/api/rooms/"+private, "")
	if plain["invited"] != nil || plain["crewOutside"] != nil {
		t.Errorf("a plain member read the door list: %v %v", plain["invited"], plain["crewOutside"])
	}
}

// Who is still not a doorkeeper (#2294). The widened gate is a crew role plus
// the room's owner and NOTHING else — in particular a ban at either level
// shuts the door on the person keeping it, which is the failure a gate
// assembled from `administers(role) || owner` alone would have shipped.
func TestWhoStillMayNotLetACrewMateIn(t *testing.T) {
	h := setup(t)
	open, _ := h.createRoom(t, "alice", "Door Refusal Open")
	private, _ := h.createRoom(t, "alice", "Door Refusal Private")
	h.makePrivate(t, private)
	crew := h.crewOf(t, private)
	h.join(t, "bob", open)
	h.makeCrewAdmin(t, crew, "carol")
	bob, carol := h.userID(t, "bob"), h.userID(t, "carol")
	path := "/api/rooms/" + private + "/grants"

	// The room's own non-owners: bob is let in, walks in, and is made a
	// coach — the highest room role that is not the owner's.
	if status, _ := h.call(t, "alice", http.MethodPost, path, fmt.Sprintf(`{"userId":%q}`, bob)); status != http.StatusNoContent {
		t.Fatalf("let bob in: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+private+"/join", ""); status != http.StatusNoContent {
		t.Fatalf("bob joins: %d", status)
	}
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+private+"/role",
		fmt.Sprintf(`{"userId":%q,"role":"coach"}`, bob)); status != http.StatusNoContent {
		t.Fatalf("make bob a coach: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, path, fmt.Sprintf(`{"userId":%q}`, carol)); status != http.StatusForbidden {
		t.Errorf("a room coach let someone in: %d, want 403", status)
	}
	if status, _ := h.call(t, "bob", http.MethodDelete, path+"/"+carol, ""); status != http.StatusForbidden {
		t.Errorf("a room coach took a door back: %d, want 403", status)
	}

	// A crew admin the ROOM's owner banned. The crew role still says admin;
	// the ban is what answers.
	if status, _ := h.call(t, "alice", http.MethodPost, path, fmt.Sprintf(`{"userId":%q}`, carol)); status != http.StatusNoContent {
		t.Fatalf("let carol in: %d", status)
	}
	if status, _ := h.call(t, "carol", http.MethodPost, "/api/rooms/"+private+"/join", ""); status != http.StatusNoContent {
		t.Fatalf("carol joins: %d", status)
	}
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+private+"/role",
		fmt.Sprintf(`{"userId":%q,"role":"banned"}`, carol)); status != http.StatusNoContent {
		t.Fatalf("ban carol from the room: %d", status)
	}
	if status, _ := h.call(t, "carol", http.MethodPost, path, fmt.Sprintf(`{"userId":%q}`, bob)); status != http.StatusForbidden {
		t.Errorf("a crew admin banned from the room let someone in: %d, want 403", status)
	}
	if status, _ := h.call(t, "carol", http.MethodDelete, path+"/"+bob, ""); status != http.StatusForbidden {
		t.Errorf("a crew admin banned from the room took a door back: %d, want 403", status)
	}

	// And a crew admin the CREW banned: the role row itself stops saying
	// admin, so the same refusal arrives by the other route.
	h.banFromCrew(t, crew, "carol")
	if status, _ := h.call(t, "carol", http.MethodPost, path, fmt.Sprintf(`{"userId":%q}`, bob)); status != http.StatusForbidden {
		t.Errorf("a crew-banned admin let someone in: %d, want 403", status)
	}

	// Nothing above moved: the owner's door list still holds only the coach
	// who walked in, which is to say nobody invited.
	_, owner := h.call(t, "alice", http.MethodGet, "/api/rooms/"+private, "")
	if _, has := owner["invited"]; has {
		t.Errorf("a refused call left a door open: %v", owner["invited"])
	}
}
