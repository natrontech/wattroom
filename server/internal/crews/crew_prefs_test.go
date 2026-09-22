package crews

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// A rider's own switches for one crew (#1100, #2432): planned-session mail
// and the weekly board's include-me.

// crewSwitches is the caller's own switches, as the Members page reads them.
func (h *harness) crewSwitches(t *testing.T, who string, crew db.GetCrewRow) map[string]any {
	t.Helper()
	me, ok := h.crewMembers(t, who, crew)["me"].(map[string]any)
	if !ok {
		t.Fatalf("%s's members page carries no switches", who)
	}
	return me
}

// The switches are the easy half; what matters is that the two queries
// downstream actually honour them, because a preference nothing reads is
// worse than no preference at all — the rider believes they are off the
// board and they are on it.
func TestCrewPrefsAreTheirOwnAndAreHonoured(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Prefs")
	for _, member := range []string{"bob", "carol"} {
		h.join(t, member, crew)
	}

	// A member's defaults are mail on and on the board: nobody is opted out
	// by joining. This is the box that a silent opt-out would fail.
	if me := h.crewSwitches(t, "bob", crew); me["notify"] != true || me["onBoard"] != true {
		t.Fatalf("a member's defaults are not mail on and on the board: %v", me)
	}

	// Bob opts out of both.
	if status, out := h.call(t, "bob", http.MethodPatch, crewPath(crew, "/me"),
		`{"notify":false,"onBoard":false}`); status != http.StatusOK {
		t.Fatalf("set prefs: %d %v", status, out)
	}
	if me := h.crewSwitches(t, "bob", crew); me["notify"] != false || me["onBoard"] != false {
		t.Errorf("preferences did not persist: %v", me)
	}
	// Carol is untouched — one rider's choice is not the crew's.
	if me := h.crewSwitches(t, "carol", crew); me["notify"] != true || me["onBoard"] != true {
		t.Errorf("bob's choice reached carol: %v", me)
	}

	// The mail list honours it. The query needs a deliverable address and the
	// global flag on, so both are set directly — without them the target list
	// is empty whatever the preference says, and the assertion below would
	// pass against a filter that does nothing.
	for _, who := range []string{"bob", "carol"} {
		if _, err := h.store.Pool.Exec(t.Context(),
			"update users set email = $2, email_verified_at = now(), notify_planned = true where id = $1",
			h.users.ByToken[who].ID, fmt.Sprintf("%s-%s@example.test", who, h.userID(t, who))); err != nil {
			t.Fatalf("give %s an address: %v", who, err)
		}
	}
	// Alice plans, so she is excluded as the planner; bob opted out; carol
	// should be the only target left.
	targets, err := h.store.Queries.ListCrewNotifyTargets(t.Context(), db.ListCrewNotifyTargetsParams{
		CrewID: crew.ID, Actor: h.users.ByToken["alice"].ID,
	})
	if err != nil {
		t.Fatalf("notify targets: %v", err)
	}
	var mailedBob, mailedCarol bool
	for _, target := range targets {
		mailedBob = mailedBob || target.ID == h.users.ByToken["bob"].ID
		mailedCarol = mailedCarol || target.ID == h.users.ByToken["carol"].ID
	}
	if mailedBob {
		t.Error("a rider who turned this crew's mail off was still a target")
	}
	if !mailedCarol {
		t.Error("nobody would be mailed, so the opt-out proves nothing")
	}

	// And the board honours it — proved with a real ride this week, because
	// an empty board proves nothing about a filter.
	voice := h.voice(t, crew)
	for _, who := range []string{"bob", "carol"} {
		h.crewRide(t, who, crew, voice, time.Now(), 300)
	}
	rows, err := h.store.Queries.CrewWeekBoard(t.Context(), crew.ID)
	if err != nil {
		t.Fatalf("board: %v", err)
	}
	var sawBob, sawCarol bool
	for _, row := range rows {
		sawBob = sawBob || row.UserID == h.users.ByToken["bob"].ID
		sawCarol = sawCarol || row.UserID == h.users.ByToken["carol"].ID
	}
	if sawBob {
		t.Error("a rider who opted out is on the board anyway")
	}
	if !sawCarol {
		t.Error("nobody is on the board, so the opt-out proves nothing")
	}
}

// The update is keyed on (crew, caller), so there is no way to spell another
// rider's switches — and someone outside the crew is refused by the same gate
// every other crew read and write uses.
func TestOnlyYouSetYourOwnCrewPrefs(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Not Yours")
	h.join(t, "bob", crew)
	path := crewPath(crew, "/me")
	off := `{"notify":false,"onBoard":false}`

	// Carol never joined, and to her the crew is not there.
	if status, _ := h.call(t, "carol", http.MethodPatch, path, off); status != http.StatusNotFound {
		t.Errorf("a rider outside the crew set switches: %d", status)
	}
	// Signed out is 401, not 404.
	if status, _ := h.call(t, "", http.MethodPatch, path, off); status != http.StatusUnauthorized {
		t.Errorf("signed out: %d, want 401", status)
	}
	// Bob's own write does not reach alice, however he addresses it: the body
	// carries no user id at all, so a smuggled one is simply refused.
	before := h.crewSwitches(t, "alice", crew)
	if status, _ := h.call(t, "bob", http.MethodPatch, path,
		fmt.Sprintf(`{"notify":false,"onBoard":false,"userId":%q}`, h.userID(t, "alice"))); status != http.StatusBadRequest {
		t.Errorf("a smuggled userId was accepted: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPatch, path, off); status != http.StatusOK {
		t.Fatalf("bob's own write: %d", status)
	}
	after := h.crewSwitches(t, "alice", crew)
	if after["notify"] != before["notify"] || after["onBoard"] != before["onBoard"] {
		t.Errorf("bob's write changed alice's switches: %v, were %v", after, before)
	}
}

// Leaving drops the crew row, so the switches reset on rejoining. That falls
// out of where they live rather than being enforced anywhere, which is
// exactly why it is worth a test — nothing else states it.
func TestLeavingTheCrewForgetsYourPreferences(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Forgetful")
	h.join(t, "bob", crew)
	if status, _ := h.call(t, "bob", http.MethodPatch, crewPath(crew, "/me"),
		`{"notify":false,"onBoard":false}`); status != http.StatusOK {
		t.Fatalf("set prefs: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, crewPath(crew, "/leave"), ""); status != http.StatusNoContent {
		t.Fatalf("leave: %d", status)
	}
	h.join(t, "bob", crew)
	if me := h.crewSwitches(t, "bob", crew); me["notify"] != true || me["onBoard"] != true {
		t.Errorf("rejoining kept the old preferences: %v", me)
	}
}
