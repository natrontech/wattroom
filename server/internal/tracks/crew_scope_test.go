package tracks

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Phase 2 of #1095 (#1103): the audio endpoint's reach is "may enter a room
// the uploader may enter", asked of visible_rooms. That is the crew scope
// ADR-0038 intends — a room open to its crew counts for the whole crew — and
// it is what closes the door #1126 did not know about: a crew ban leaves
// the membership row in place, so the old "shares a room" join kept handing
// a crew-banned rider the bytes.

// crewOf makes owner a crew and returns it; the migration does this for
// every existing owner, tests make theirs.
func (h *harness) crewOf(t *testing.T, owner string) db.Crew {
	t.Helper()
	crew, err := h.store.Queries.CreateCrew(t.Context(), db.CreateCrewParams{
		Name: owner, OwnerID: h.users.ByToken[owner].ID,
	})
	if err != nil {
		t.Fatalf("crew: %v", err)
	}
	t.Cleanup(func() {
		_, _ = h.store.Pool.Exec(context.Background(), "delete from crews where id = $1", crew.ID)
	})
	return crew
}

// crewRoom makes a room owned by owner inside crew, open to the crew or
// private, with the owner's membership — and nobody else's.
func (h *harness) crewRoom(t *testing.T, owner string, crew db.Crew, open bool, n int) db.Room {
	t.Helper()
	slug := strings.ToLower(strings.ReplaceAll(t.Name(), "/", "-"))
	room, err := h.store.Queries.CreateRoom(t.Context(), db.CreateRoomParams{
		// A prefix nothing else in the suite uses: rooms.code is unique
		// across the whole shared wattroom_test.
		Slug: fmt.Sprintf("crew-scope-%d-%s", n, slug),
		Name: "Crew Scope", OwnerID: h.users.ByToken[owner].ID,
	})
	if err != nil {
		t.Fatalf("create room: %v", err)
	}
	t.Cleanup(func() {
		_, _ = h.store.Pool.Exec(context.Background(), "delete from rooms where id = $1", room.ID)
	})
	if err := h.store.Queries.PlaceRoomInCrew(t.Context(), db.PlaceRoomInCrewParams{
		ID: room.ID, CrewID: crew.ID, CrewVisible: open,
	}); err != nil {
		t.Fatalf("place: %v", err)
	}
	if err := h.store.Queries.CreateMembership(t.Context(), db.CreateMembershipParams{
		RoomID: room.ID, UserID: h.users.ByToken[owner].ID, Role: "owner",
	}); err != nil {
		t.Fatalf("owner membership: %v", err)
	}
	return room
}

func (h *harness) member(t *testing.T, room db.Room, who string) {
	t.Helper()
	if err := h.store.Queries.CreateMembership(t.Context(), db.CreateMembershipParams{
		RoomID: room.ID, UserID: h.users.ByToken[who].ID, Role: "member",
	}); err != nil {
		t.Fatalf("membership %s: %v", who, err)
	}
}

func (h *harness) audio(t *testing.T, who, id string) int {
	t.Helper()
	return h.do(t, who, http.MethodGet, "/api/tracks/"+id+"/audio", nil).Code
}

// The widening: bob joined one of alice's rooms, and alice's OTHER room is
// open to the crew. Bob may enter it and alice may enter it, so they share
// a room in the sense that matters — and alice's track plays for him, even
// though he never joined that room and the old join would have said no.
func TestATrackReachesWhoeverMayEnterARoomItsUploaderMayEnter(t *testing.T) {
	h := setup(t)
	track := h.upload(t, "alice", song(41, 383), "Crew.mp3")
	id, _ := track["id"].(string)
	crew := h.crewOf(t, "alice")
	private := h.crewRoom(t, "alice", crew, false, 1)
	open := h.crewRoom(t, "alice", crew, true, 2)

	if code := h.audio(t, "bob", id); code != http.StatusNotFound {
		t.Fatalf("a stranger could play it (%d) — test proves nothing", code)
	}
	// Bob is in the crew now through the private room; the open room is
	// enterable for him, and alice is in it.
	h.member(t, private, "bob")
	if code := h.audio(t, "bob", id); code != http.StatusOK {
		t.Errorf("a crew-mate who may enter a room alice may enter cannot play her track: %d", code)
	}
	_ = open
	// Browsing is not widened: her shelf stays hers — not listed, not
	// editable, not deletable by a crew-mate who may hear it.
	if w := h.do(t, "bob", http.MethodPatch, "/api/tracks/"+id, []byte(`{"title":"Mine now"}`)); w.Code != http.StatusNotFound {
		t.Errorf("the crew widened editing alice's track, not just hearing it: %d", w.Code)
	}
	if w := h.do(t, "bob", http.MethodDelete, "/api/tracks/"+id, nil); w.Code != http.StatusNotFound {
		t.Errorf("the crew widened deleting alice's track: %d", w.Code)
	}
	if strings.Contains(h.do(t, "bob", http.MethodGet, "/api/tracks", nil).Body.String(), id) {
		t.Errorf("the crew widened listing alice's shelf")
	}
}

// The door #1126 did not list. A crew ban keeps the membership row; the old
// join read the row and kept playing. Silent if it regresses — the bytes go
// out, nothing errors — so this was seen red against the old query.
func TestACrewBannedRiderCannotPlayACrewMatesTrack(t *testing.T) {
	h := setup(t)
	track := h.upload(t, "alice", song(42, 383), "Banned.mp3")
	id, _ := track["id"].(string)
	crew := h.crewOf(t, "alice")
	room := h.crewRoom(t, "alice", crew, true, 3)
	h.member(t, room, "bob")
	if code := h.audio(t, "bob", id); code != http.StatusOK {
		t.Fatalf("bob could not play it before the ban (%d) — test proves nothing", code)
	}

	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: crew.ID, UserID: h.users.ByToken["bob"].ID, Role: "banned",
	}); err != nil {
		t.Fatalf("crew ban: %v", err)
	}
	if code := h.audio(t, "bob", id); code != http.StatusNotFound {
		t.Errorf("a crew-banned rider still played a crew-mate's track: %d, want 404", code)
	}
	if code := h.audio(t, "alice", id); code != http.StatusOK {
		t.Errorf("banning bob cost alice her own track: %d", code)
	}
}

// Another crew's track is not there: not to read, not to hear. Queueing it
// into a room is the same door — the hub takes any track id on "add" and
// every rider's deck then asks this endpoint, which is where it 404s.
func TestAnotherCrewsTrackIsNotThere(t *testing.T) {
	h := setup(t)
	track := h.upload(t, "alice", song(43, 383), "Elsewhere.mp3")
	id, _ := track["id"].(string)
	theirs := h.crewOf(t, "alice")
	h.crewRoom(t, "alice", theirs, true, 4)
	mine := h.crewOf(t, "bob")
	h.crewRoom(t, "bob", mine, true, 5)

	if w := h.do(t, "bob", http.MethodPatch, "/api/tracks/"+id, []byte(`{"title":"Mine now"}`)); w.Code != http.StatusNotFound {
		t.Errorf("edit: %d, want 404", w.Code)
	}
	if strings.Contains(h.do(t, "bob", http.MethodGet, "/api/tracks", nil).Body.String(), id) {
		t.Errorf("another crew's track is listed on bob's shelf")
	}
	if code := h.audio(t, "bob", id); code != http.StatusNotFound {
		t.Errorf("audio: %d, want 404", code)
	}
}
