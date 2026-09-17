package rooms

import (
	"net/http"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The other door to the same end (#2079): the crew's last room goes while
// somebody is still in the crew — so the crew rightly survives (#1236, #1476)
// — and then that somebody leaves. Nothing swept there, and the owner was
// left with a crew they can neither leave (they own it), hand on (nobody is
// left) nor delete (there is no such button).
//
// The table asks each crew state for the TWO answers that have to agree, the
// way the room-delete table above does: what the leaver's confirm was told
// beforehand (`crew.lastOut` on the crews list), and what the leave then did.

// joinCrew is the crew's door and nothing else — no room. The state the room
// count in the confirm cannot tell apart from an empty crew.
func (h *harness) joinCrew(t *testing.T, who, code string) {
	t.Helper()
	if status, body := h.call(t, who, http.MethodPost, "/api/crews/join", `{"code":"`+code+`"}`); status != http.StatusOK {
		t.Fatalf("%s could not join the crew: %d %v", who, status, body)
	}
}

// deleteRoom is the owner removing a room, asserted to land.
func (h *harness) deleteRoom(t *testing.T, who, slug string) {
	t.Helper()
	if status, body := h.call(t, who, http.MethodDelete, "/api/rooms/"+slug, ""); status != http.StatusNoContent {
		t.Fatalf("%s deleting %s: %d %v", who, slug, status, body)
	}
}

// lastOut is what the crews list tells a caller about the crew's fate if they
// leave. Absent means false — the field is omitempty — and `listed` says
// whether the crew was on their list at all.
func (h *harness) lastOut(t *testing.T, who string, crew db.GetCrewRow) (flag, listed bool) {
	t.Helper()
	status, body := h.call(t, who, http.MethodGet, "/api/rooms", "")
	if status != http.StatusOK {
		t.Fatalf("%s reading their rooms: %d %v", who, status, body)
	}
	rows, _ := body["crews"].([]any)
	for _, raw := range rows {
		row, _ := raw.(map[string]any)
		if row["id"] == store.UUIDString(crew.ID) {
			flag, _ = row["lastOut"].(bool)
			return flag, true
		}
	}
	return false, false
}

var crewLeaveStates = []struct {
	name string
	// The crew as bob finds it, beyond his own membership of it. alice owns
	// it and the room it was made with; bob has joined its door.
	setup func(t *testing.T, h *harness, slug, code string, crew db.GetCrewRow)
	// Whether bob leaving should take the crew with it.
	goes bool
}{
	{
		// #2079's path: the room went first, with bob still in the crew.
		name: "no rooms left, and nobody but bob and the owner",
		setup: func(t *testing.T, h *harness, slug, code string, crew db.GetCrewRow) {
			h.deleteRoom(t, "alice", slug)
		},
		goes: true,
	},
	{
		// The same, for someone who had walked into the room as well: their
		// membership went with it, and the crew role is all that is left.
		name: "the room bob was in was deleted under him",
		setup: func(t *testing.T, h *harness, slug, code string, crew db.GetCrewRow) {
			if status, body := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/join", ""); status != http.StatusNoContent {
				t.Fatalf("bob could not enter the room: %d %v", status, body)
			}
			h.deleteRoom(t, "alice", slug)
		},
		goes: true,
	},
	{
		// An admin row is a member row for this purpose: the leave takes it,
		// and what is left is nothing.
		name: "bob is the crew's admin and no room is left",
		setup: func(t *testing.T, h *harness, slug, code string, crew db.GetCrewRow) {
			h.makeCrewAdmin(t, crew, "bob")
			h.deleteRoom(t, "alice", slug)
		},
		goes: true,
	},
	{
		// A ban is not somebody who is in the crew — the same rule the room
		// delete follows — so it does not save the crew from bob's leave.
		name: "no rooms left, and only a banned row besides bob",
		setup: func(t *testing.T, h *harness, slug, code string, crew db.GetCrewRow) {
			h.joinCrew(t, "carol", code)
			h.banFromCrew(t, crew, "carol")
			h.deleteRoom(t, "alice", slug)
		},
		goes: true,
	},
	{
		// THE case the client cannot tell from the one above: bob is in none
		// of the crew's rooms, so his confirm counts zero rooms either way —
		// and here the crew stays and its code really does get him back in.
		name: "a room bob is in none of is still there",
		goes: false,
	},
	{
		name: "somebody else is left in the crew",
		setup: func(t *testing.T, h *harness, slug, code string, crew db.GetCrewRow) {
			h.joinCrew(t, "carol", code)
			h.deleteRoom(t, "alice", slug)
		},
		goes: false,
	},
}

func TestACrewGoesWithItsLastMemberWhenNoRoomIsLeft(t *testing.T) {
	for _, tc := range crewLeaveStates {
		t.Run(tc.name, func(t *testing.T) {
			h := setup(t)
			slug, code := h.createRoom(t, "alice", "Crew Leave Room")
			crew := h.crewOf(t, slug)
			h.joinCrew(t, "bob", code)
			if tc.setup != nil {
				tc.setup(t, h, slug, code, crew)
			}

			// What the confirm is told, before the button is drawn.
			told, listed := h.lastOut(t, "bob", crew)
			if !listed {
				t.Fatalf("bob's crews list does not carry the crew he is in")
			}
			if told != tc.goes {
				t.Errorf("crew.lastOut = %v, want %v: the confirm says the wrong thing", told, tc.goes)
			}
			path := "/api/crews/" + store.UUIDString(crew.ID) + "/leave"
			if status, body := h.call(t, "bob", http.MethodPost, path, ""); status != http.StatusNoContent {
				t.Fatalf("bob leaving the crew: %d %v", status, body)
			}
			if gone := h.crewGone(t, crew); gone != tc.goes {
				if gone {
					t.Errorf("the crew went with its last member and should have stayed")
				} else {
					t.Errorf("the crew outlived everything in it — its owner cannot leave, hand it on or delete it")
				}
			}
		})
	}
}

// A ban is not a sweep, deliberately (#2079). Banning the last member of a
// room-less crew leaves the same litter, and it stays litter: an owner's own
// moderation click silently destroying the crew — its name, its logo, its
// invite code — is the more surprising of the two outcomes. DeleteCrewIfEmpty
// does not count a banned row, so the no-op is a decision this test pins
// rather than an omission: lifting the ban gives the rider back the Leave
// that does sweep it.
func TestBanningTheLastMemberDoesNotEndTheCrew(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Crew Ban Room")
	crew := h.crewOf(t, slug)
	h.joinCrew(t, "bob", code)
	h.deleteRoom(t, "alice", slug)

	h.banFromCrew(t, crew, "bob")
	if h.crewGone(t, crew) {
		t.Fatal("the ban destroyed the crew — its owner's moderation click took the name, logo and code with it")
	}
	// The one state where the crew is room-less and holds nobody the sweep
	// counts while somebody is still reading their crews list: the owner's.
	// They cannot leave at all, so their Leave never ends anything and the
	// flag must not say it does.
	if told, listed := h.lastOut(t, "alice", crew); told || !listed {
		t.Errorf("the owner's crew.lastOut = %v (listed %v): an owner cannot leave, so leaving cannot end the crew", told, listed)
	}

	// The way back out, so the state is not a dead end: the ban lifted is a
	// member row again, and that member's leave is the sweep.
	body := `{"userId":"` + h.userID(t, "bob") + `","role":"member"}`
	if status, out := h.call(t, "alice", http.MethodPost, "/api/crews/"+store.UUIDString(crew.ID)+"/role", body); status != http.StatusNoContent {
		t.Fatalf("lift the ban: %d %v", status, out)
	}
	if status, out := h.call(t, "bob", http.MethodPost, "/api/crews/"+store.UUIDString(crew.ID)+"/leave", ""); status != http.StatusNoContent {
		t.Fatalf("bob leaving after the ban was lifted: %d %v", status, out)
	}
	if !h.crewGone(t, crew) {
		t.Error("the crew outlived its last member leaving")
	}
}
