package rooms

import (
	"errors"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// A crew with nothing left in it goes with its last room (#1935). Its owner
// could otherwise neither leave it (they own it), hand it on (nobody to hand
// it to) nor delete it (there is no such button), and ADR-0038's second
// amendment already says such a crew is deleted rather than left ownerless.
//
// The table asks every crew state for the TWO answers that have to agree: what
// the owner's delete confirm was told beforehand (`crew.goesWithRoom`), and
// what the delete then did. They come from two SQL predicates, and a confirm
// that promises what the delete will not do is the bug this pairing catches.

// goesWithRoom is what the room read tells the caller about the crew's fate.
// Absent means false — the field is omitempty — so the flag reads the same
// either way, and `sent` says which it was.
func (h *harness) goesWithRoom(t *testing.T, who, slug string) (flag, sent bool) {
	t.Helper()
	status, body := h.call(t, who, http.MethodGet, "/api/rooms/"+slug, "")
	if status != http.StatusOK {
		t.Fatalf("%s reading %s: %d %v", who, slug, status, body)
	}
	crew, ok := body["crew"].(map[string]any)
	if !ok {
		t.Fatalf("%s's read of %s carried no crew: %v", who, slug, body)
	}
	flag, sent = crew["goesWithRoom"].(bool)
	return flag, sent
}

// crewGone reports whether the crew row is no longer there, failing loudly on
// any other database answer — a lookup that errored for another reason must
// not read as a deletion.
func (h *harness) crewGone(t *testing.T, crew db.GetCrewRow) bool {
	t.Helper()
	_, err := h.store.Queries.GetCrew(t.Context(), crew.ID)
	if err == nil {
		return false
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("crew read: %v", err)
	}
	return true
}

// banFromCrew is alice removing someone from her crew, through the surface a
// rider uses. A pre-emptive ban is refused for a room owner (#1212), so the
// target must own none — which is true of everyone this table bans.
func (h *harness) banFromCrew(t *testing.T, crew db.GetCrewRow, who string) {
	t.Helper()
	body := `{"userId":"` + h.userID(t, who) + `","role":"banned"}`
	path := "/api/crews/" + store.UUIDString(crew.ID) + "/role"
	if status, out := h.call(t, "alice", http.MethodPost, path, body); status != http.StatusNoContent {
		t.Fatalf("ban %s from the crew: %d %v", who, status, out)
	}
}

var crewEndStates = []struct {
	name string
	// Everything in the crew besides the room the test then deletes.
	setup func(t *testing.T, h *harness, slug, code string, crew db.GetCrewRow)
	// Whether deleting that room should take the crew with it.
	goes bool
}{
	{
		name: "nobody but the owner, and no other room",
		goes: true,
	},
	{
		name: "somebody joined the crew and no room of it",
		setup: func(t *testing.T, h *harness, slug, code string, crew db.GetCrewRow) {
			if status, body := h.call(t, "bob", http.MethodPost, "/api/crews/join", `{"code":"`+code+`"}`); status != http.StatusOK {
				t.Fatalf("bob could not join the crew: %d %v", status, body)
			}
		},
		goes: false,
	},
	{
		name: "somebody is in the room as well",
		setup: func(t *testing.T, h *harness, slug, code string, crew db.GetCrewRow) {
			h.enter(t, "bob", code, slug)
		},
		goes: false,
	},
	{
		name: "an admin is left in the crew",
		setup: func(t *testing.T, h *harness, slug, code string, crew db.GetCrewRow) {
			h.enter(t, "bob", code, slug)
			body := `{"userId":"` + h.userID(t, "bob") + `","role":"admin"}`
			if status, out := h.call(t, "alice", http.MethodPost, "/api/crews/"+store.UUIDString(crew.ID)+"/role", body); status != http.StatusNoContent {
				t.Fatalf("make bob an admin: %d %v", status, out)
			}
		},
		goes: false,
	},
	{
		// A ban is not somebody who is in the crew, and a ban outliving every
		// room would be the whole bug again for any owner who ever banned
		// anyone. The ban goes with the crew it was a ban on.
		name: "only a banned row is left",
		setup: func(t *testing.T, h *harness, slug, code string, crew db.GetCrewRow) {
			h.enter(t, "bob", code, slug)
			h.banFromCrew(t, crew, "bob")
		},
		goes: true,
	},
	{
		name: "another room of the crew is still there",
		setup: func(t *testing.T, h *harness, slug, code string, crew db.GetCrewRow) {
			h.createRoom(t, "alice", "Crew Second Room")
		},
		goes: false,
	},
	{
		// The two halves of the predicate must BOTH have to hold: a room left
		// in the crew keeps it even with nobody but the owner in it.
		name: "another room, and only a banned row besides the owner",
		setup: func(t *testing.T, h *harness, slug, code string, crew db.GetCrewRow) {
			h.createRoom(t, "alice", "Crew Second Room")
			h.enter(t, "bob", code, slug)
			h.banFromCrew(t, crew, "bob")
		},
		goes: false,
	},
}

func TestACrewGoesWithItsLastRoomWhenNothingIsLeftInIt(t *testing.T) {
	for _, tc := range crewEndStates {
		t.Run(tc.name, func(t *testing.T) {
			h := setup(t)
			slug, code := h.createRoom(t, "alice", "Crew Last Room")
			crew := h.crewOf(t, slug)
			if tc.setup != nil {
				tc.setup(t, h, slug, code, crew)
			}

			// What the confirm is told, before the button is drawn.
			if told, _ := h.goesWithRoom(t, "alice", slug); told != tc.goes {
				t.Errorf("crew.goesWithRoom = %v, want %v: the confirm says the wrong thing", told, tc.goes)
			}
			if status, body := h.call(t, "alice", http.MethodDelete, "/api/rooms/"+slug, ""); status != http.StatusNoContent {
				t.Fatalf("delete the room: %d %v", status, body)
			}
			if gone := h.crewGone(t, crew); gone != tc.goes {
				if gone {
					t.Errorf("the crew went with the room and should have stayed")
				} else {
					t.Errorf("the crew outlived its last room with nothing in it — its owner cannot leave, hand it on or delete it")
				}
			}
		})
	}
}

// The flag is the room owner's business: only they can delete the room, and
// only their confirm has a line to add. A member reading the same room gets
// the crew without it.
func TestOnlyTheRoomsOwnerIsToldTheCrewGoesWithIt(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Crew Flag Room")
	h.enter(t, "bob", code, slug)
	if _, sent := h.goesWithRoom(t, "bob", slug); sent {
		t.Error("a member was told what deleting the room would do to the crew")
	}
}

// A crew keeps every room it still has: `rooms.crew_id` is ON DELETE RESTRICT
// (ADR-0038's fourth amendment), so an automatic crew deletion can never
// orphan a room — and #1301 is about to make a null `crew_id` illegal.
func TestDeletingARoomNeverOrphansAnotherInItsCrew(t *testing.T) {
	h := setup(t)
	first, _ := h.createRoom(t, "alice", "Crew Kept Room")
	crew := h.crewOf(t, first)
	second, _ := h.createRoom(t, "alice", "Crew Other Room")

	if status, body := h.call(t, "alice", http.MethodDelete, "/api/rooms/"+first, ""); status != http.StatusNoContent {
		t.Fatalf("delete the first room: %d %v", status, body)
	}
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), second)
	if err != nil {
		t.Fatalf("the surviving room: %v", err)
	}
	if !room.CrewID.Valid || room.CrewID != crew.ID {
		t.Errorf("the surviving room's crew is %v, want %v", room.CrewID, crew.ID)
	}
}

// The delete route's contract (errors.md). There is no request body and no
// path value beyond the slug, so nothing here can be a 400: an unreadable
// address is a room that does not exist, which is the 404.
func TestDeletingARoomRefusesEveryoneButItsOwner(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Crew Contract Room")
	h.join(t, "bob", slug)

	for _, tc := range []struct {
		name, who, path string
		want            int
	}{
		{"signed out", "", "/api/rooms/" + slug, http.StatusUnauthorized},
		{"signed out, and no such room either", "", "/api/rooms/not-a-room", http.StatusUnauthorized},
		{"a member who does not own it", "bob", "/api/rooms/" + slug, http.StatusForbidden},
		{"a rider who is not in it", "carol", "/api/rooms/" + slug, http.StatusForbidden},
		{"no such room", "alice", "/api/rooms/not-a-room", http.StatusNotFound},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if status, body := h.call(t, tc.who, http.MethodDelete, tc.path, ""); status != tc.want {
				t.Errorf("DELETE %s as %q: %d, want %d (%v)", tc.path, tc.who, status, tc.want, body)
			}
		})
	}
	if status, body := h.call(t, "alice", http.MethodDelete, "/api/rooms/"+slug, ""); status != http.StatusNoContent {
		t.Fatalf("the owner deleting it: %d %v", status, body)
	}
}
