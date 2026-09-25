package crews

import (
	"errors"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

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

// stripChannels takes a crew down to nothing but its owner: no channels, so
// no history either.
func (h *harness) stripChannels(t *testing.T, crew db.GetCrewRow) {
	t.Helper()
	if _, err := h.store.Pool.Exec(t.Context(), "delete from channels where crew_id = $1", crew.ID); err != nil {
		t.Fatalf("strip the crew's channels: %v", err)
	}
}

// A crew with nothing left in it goes (#1935, #2079, #2837): no channel — its
// channels and their history are what a crew holds (ADR-0058, #2502) — and
// nobody in it but its owner. So its last member leaving takes a crew that
// was stripped of its channels, and nothing else; a ban never does (#2079:
// an owner's moderation click must not destroy the crew), and neither does
// the owner's own switch row (#2493), which is not somebody else in it.
func TestACrewWithNothingLeftGoesWithItsLastMember(t *testing.T) {
	leave := func(t *testing.T, h *harness, crew db.GetCrewRow, who string) {
		t.Helper()
		if status, body := h.call(t, who, http.MethodPost, crewPath(crew, "/leave"), ""); status != http.StatusNoContent {
			t.Fatalf("%s leaving: %d %v", who, status, body)
		}
	}
	for _, tc := range []struct {
		name     string
		stripped bool
		out      func(t *testing.T, h *harness, crew db.GetCrewRow)
		gone     bool
	}{
		{"he leaves a crew that still has its channels", false, func(t *testing.T, h *harness, crew db.GetCrewRow) {
			leave(t, h, crew, "bob")
		}, false},
		{"he leaves a crew with no channels", true, func(t *testing.T, h *harness, crew db.GetCrewRow) {
			leave(t, h, crew, "bob")
		}, true},
		{"he leaves, and the owner's own switches are a row too", true, func(t *testing.T, h *harness, crew db.GetCrewRow) {
			if _, err := h.store.Queries.SetCrewPrefs(t.Context(), db.SetCrewPrefsParams{
				CrewID: crew.ID, UserID: h.users.ByToken["alice"].ID, Notify: false, OnBoard: true,
			}); err != nil {
				t.Fatalf("owner's switches: %v", err)
			}
			leave(t, h, crew, "bob")
		}, true},
		{"he leaves, and carol is still in it", true, func(t *testing.T, h *harness, crew db.GetCrewRow) {
			h.join(t, "carol", crew)
			leave(t, h, crew, "bob")
		}, false},
		{"he is banned", true, func(t *testing.T, h *harness, crew db.GetCrewRow) {
			h.banFromCrew(t, crew, "bob")
		}, false},
		{"he is banned, the ban is lifted, and he leaves", true, func(t *testing.T, h *harness, crew db.GetCrewRow) {
			h.banFromCrew(t, crew, "bob")
			body := `{"userId":"` + h.userID(t, "bob") + `","role":"member"}`
			if status, out := h.call(t, "alice", http.MethodPost, crewPath(crew, "/role"), body); status != http.StatusNoContent {
				t.Fatalf("lift the ban: %d %v", status, out)
			}
			leave(t, h, crew, "bob")
		}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := setup(t)
			crew := h.newCrew(t, "alice", "Crew Leave")
			h.join(t, "bob", crew)
			if tc.stripped {
				h.stripChannels(t, crew)
			}

			tc.out(t, h, crew)

			if gone := h.crewGone(t, crew); gone != tc.gone {
				t.Fatalf("crew gone %v, want %v", gone, tc.gone)
			}
			if !tc.gone {
				if status, body := h.call(t, "alice", http.MethodGet, crewPath(crew), ""); status != http.StatusOK || body["role"] != "owner" {
					t.Errorf("the owner reads the crew as %d %v, want it still hers", status, body["role"])
				}
			}
		})
	}
}

// The confirms say which case it is before the button (#2079, #2837), so the
// crew list carries the server's word: whether deleting the owner's one
// channel takes the crew, and whether a member leaving takes it.
func TestTheCrewListSaysWhenTheCrewGoesWithTheNextStep(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Crew Flags")
	flags := func(who string) (goesWithChannel, lastOut bool) {
		t.Helper()
		status, body := h.call(t, who, http.MethodGet, "/api/crews", "")
		if status != http.StatusOK {
			t.Fatalf("%s's crews: %d %v", who, status, body)
		}
		list, _ := body["crews"].([]any)
		for _, c := range list {
			ref, _ := c.(map[string]any)
			if ref["id"] == store.UUIDString(crew.ID) {
				g, _ := ref["goesWithChannel"].(bool)
				l, _ := ref["lastOut"].(bool)
				return g, l
			}
		}
		t.Fatalf("%s's crews do not list the crew: %v", who, body)
		return false, false
	}
	channels, err := h.store.Queries.ListCrewChannels(t.Context(), crew.ID)
	if err != nil || len(channels) < 2 {
		t.Fatalf("a founded crew opens with its channels: %d %v", len(channels), err)
	}
	if g, _ := flags("alice"); g {
		t.Error("two channels, and deleting one was said to take the crew")
	}
	if _, err := h.store.Pool.Exec(t.Context(), "delete from channels where id = $1", channels[0].ID); err != nil {
		t.Fatalf("delete a channel: %v", err)
	}
	if g, _ := flags("alice"); !g {
		t.Error("the owner alone with one channel was not told deleting it takes the crew")
	}

	h.join(t, "bob", crew)
	if g, _ := flags("alice"); g {
		t.Error("with bob in it, deleting the last channel was said to take the crew")
	}
	if _, l := flags("bob"); l {
		t.Error("a crew with a channel was said to go when bob leaves")
	}
	h.stripChannels(t, crew)
	if _, l := flags("bob"); !l {
		t.Error("bob, the last one in a crew with no channels, was not told it goes when he leaves")
	}
	if _, l := flags("alice"); l {
		t.Error("the owner cannot leave, so lastOut is never hers")
	}
}
