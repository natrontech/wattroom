package crews

import (
	"errors"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5"

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

// A crew is deleted only on succession with nobody left to take it
// (docs/SPEC.md, Succession). Its last member going — by leaving, by a ban, or
// by leaving once a ban is lifted — ends nothing, even in a crew stripped to
// its owner alone: the owner still has it, its name, its logo and its code.
func TestACrewOutlivesItsLastMember(t *testing.T) {
	leave := func(t *testing.T, h *harness, crew db.GetCrewRow) {
		t.Helper()
		if status, body := h.call(t, "bob", http.MethodPost, crewPath(crew, "/leave"), ""); status != http.StatusNoContent {
			t.Fatalf("bob leaving: %d %v", status, body)
		}
	}
	for _, tc := range []struct {
		name string
		out  func(t *testing.T, h *harness, crew db.GetCrewRow)
	}{
		{"he leaves", leave},
		{"he is banned", func(t *testing.T, h *harness, crew db.GetCrewRow) {
			h.banFromCrew(t, crew, "bob")
		}},
		{"he is banned, the ban is lifted, and he leaves", func(t *testing.T, h *harness, crew db.GetCrewRow) {
			h.banFromCrew(t, crew, "bob")
			body := `{"userId":"` + h.userID(t, "bob") + `","role":"member"}`
			if status, out := h.call(t, "alice", http.MethodPost, crewPath(crew, "/role"), body); status != http.StatusNoContent {
				t.Fatalf("lift the ban: %d %v", status, out)
			}
			leave(t, h, crew)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := setup(t)
			crew := h.newCrew(t, "alice", "Crew Leave")
			h.join(t, "bob", crew)
			h.stripChannels(t, crew)

			tc.out(t, h, crew)

			if h.crewGone(t, crew) {
				t.Fatal("the crew went with its last member — only succession with nobody left ends a crew")
			}
			if status, body := h.call(t, "alice", http.MethodGet, crewPath(crew), ""); status != http.StatusOK || body["role"] != "owner" {
				t.Errorf("the owner reads the crew as %d %v, want it still hers", status, body["role"])
			}
		})
	}
}
