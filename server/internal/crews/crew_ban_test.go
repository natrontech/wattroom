package crews

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// banFromCrew is alice banning someone from her crew, through the surface a
// rider uses.
func (h *harness) banFromCrew(t *testing.T, crew db.GetCrewRow, who string) {
	t.Helper()
	body := `{"userId":"` + h.userID(t, who) + `","role":"banned"}`
	if status, out := h.call(t, "alice", http.MethodPost, crewPath(crew, "/role"), body); status != http.StatusNoContent {
		t.Fatalf("ban %s from the crew: %d %v", who, status, out)
	}
}

// A crew ban shuts the crew to one person (ADR-0038, third amendment; the one
// ban since ADR-0058). crewByID reads the role on every request, so each door
// below has to refuse a banned rider the way it refuses a stranger: 404, since
// a crew's existence is not public.
//
// All of these fail silently if they regress — the door opens, nothing errors.

func TestACrewBanClosesEveryCrewDoor(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Velvet Hammer")
	h.join(t, "bob", crew)

	// Each door, open before the ban. Without this the test would pass
	// against a door that was broken all along.
	doors := []struct {
		name   string
		method string
		path   string
		body   string
		open   int
	}{
		{"the crew itself", http.MethodGet, crewPath(crew), "", http.StatusOK},
		// Where the rider's own switches are read: losing it is losing them.
		{"the members page", http.MethodGet, crewPath(crew, "/members"), "", http.StatusOK},
		{"the recaps", http.MethodGet, crewPath(crew, "/recaps"), "", http.StatusOK},
		{"the schedule", http.MethodGet, crewPath(crew, "/schedule"), "", http.StatusOK},
		{"the rider's own switches", http.MethodPatch, crewPath(crew, "/me"),
			`{"notify":true,"onBoard":true}`, http.StatusOK},
	}
	for _, d := range doors {
		if status, _ := h.call(t, "bob", d.method, d.path, d.body); status != d.open {
			t.Fatalf("%s was not open before the ban (%d) — test proves nothing", d.name, status)
		}
	}

	h.banFromCrew(t, crew, "bob")

	for _, d := range doors {
		if status, _ := h.call(t, "bob", d.method, d.path, d.body); status != http.StatusNotFound {
			t.Errorf("%s: a crew-banned rider was let in (%d)", d.name, status)
		}
	}
}

// Rejoining is the path a ban exists to shut, and leaving is no way round it
// (#637): the banned row is the ban, so the leave refuses, the row stays, and
// the code stays shut.
func TestACrewBanSurvivesRejoining(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Velvet Hammer")
	h.join(t, "bob", crew)
	h.banFromCrew(t, crew, "bob")

	join := fmt.Sprintf(`{"code":%q}`, codeOf(crew.Code))
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/crews/join", join); status != http.StatusForbidden {
		t.Errorf("a crew-banned rider joined by code: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, crewPath(crew, "/leave"), ""); status != http.StatusNotFound {
		t.Errorf("a crew-banned rider left the crew: %d", status)
	}
	if role := h.crewRole(t, crew, h.users.ByToken["bob"].ID); role != "banned" {
		t.Fatalf("bob's ban reads %q after he tried to leave", role)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/crews/join", join); status != http.StatusForbidden {
		t.Errorf("a crew-banned rider rejoined after trying to leave: %d", status)
	}
}

// A crew ban is one person in one crew. The blast radius is the thing most
// likely to be got wrong by a query written slightly too loosely.
func TestACrewBanTouchesNobodyElse(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Velvet Hammer")
	for _, who := range []string{"bob", "carol"} {
		h.join(t, who, crew)
	}
	h.banFromCrew(t, crew, "bob")

	prefs := `{"notify":true,"onBoard":true}`
	if status, _ := h.call(t, "carol", http.MethodPatch, crewPath(crew, "/me"), prefs); status != http.StatusOK {
		t.Errorf("banning bob shut carol out of her own switches: %d", status)
	}
	if status, _ := h.call(t, "alice", http.MethodPatch, crewPath(crew, "/me"), prefs); status != http.StatusOK {
		t.Errorf("banning bob shut the owner out of her own crew: %d", status)
	}
}
