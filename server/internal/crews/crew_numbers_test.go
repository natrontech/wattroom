package crews

// What the crew's Members page counts (#2442): what the crew rode together,
// and the weekly board. Both publish numbers drawn from members' rides, so
// what each one leaves out is the half worth asserting.

import (
	"net/http"
	"testing"
	"time"
)

// The together block is cooperative — everyone's seconds summed, a session
// counted once however many rode it — and its strip is the caller's own
// turnout, never anybody else's (ADR-0036).
func TestCrewTogetherIsCooperativeAndOwn(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Together Crew")
	h.join(t, "bob", crew)
	voice := h.voice(t, crew)

	// Days pinned inside this month and the last, so the month buckets do
	// not move with the day the test runs on.
	now := time.Now().UTC()
	first := time.Date(now.Year(), now.Month(), 1, 12, 0, 0, 0, time.UTC)
	second := first.AddDate(0, 0, 1)
	lastMonth := first.AddDate(0, 0, -14)
	// Two riders on one day is ONE session, and both their seconds count.
	h.crewRide(t, "alice", crew, voice, second, 300)
	h.crewRide(t, "bob", crew, voice, second, 300)
	// A second session this month, alice only.
	h.crewRide(t, "alice", crew, voice, first, 300)
	// And one last month, so the month-on-month figure has something behind it.
	h.crewRide(t, "bob", crew, voice, lastMonth, 300)

	together := func(who string) map[string]any {
		t.Helper()
		status, body := h.call(t, who, http.MethodGet, crewPath(crew, "/members"), "")
		block, ok := body["together"].(map[string]any)
		if status != http.StatusOK || !ok {
			t.Fatalf("%s reads no together block: %d %v", who, status, body)
		}
		return block
	}
	block := together("alice")
	// crewRide rides 1800 seconds; four of them, whoever rode.
	for field, want := range map[string]float64{"seconds": 4 * 1800, "sessionsThisMonth": 2, "sessionsLastMonth": 1} {
		if got, _ := block[field].(float64); got != want {
			t.Errorf("together.%s = %v, want %v", field, block[field], want)
		}
	}

	attended := func(who string) []bool {
		t.Helper()
		raw, _ := together(who)["attended"].([]any)
		out := make([]bool, len(raw))
		for i, v := range raw {
			out[i], _ = v.(bool)
		}
		return out
	}
	// Oldest first: last month, the first, the second.
	if got := attended("alice"); len(got) != 3 || got[0] || !got[1] || !got[2] {
		t.Errorf("alice attended = %v, want [false true true]", got)
	}
	if got := attended("bob"); len(got) != 3 || !got[0] || got[1] || !got[2] {
		t.Errorf("bob attended = %v, want [true false true]", got)
	}
}

// The board is this week's work, ranked by it (ADR-0036), and it withholds a
// category nobody chose (ADR-0048, #2243): "two guesses divided by each
// other is a fiction with a decimal point", and the board is the surface that
// publishes one member's number to the rest. The row stays and still ranks —
// kJ is ridden, not typed.
func TestTheCrewBoardIsThisWeekAndWithholdsAGuess(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Board Crew")
	// On before anyone joins, so the door they walk through names it (#2820).
	if status, body := h.call(t, "alice", http.MethodPatch, crewPath(crew), `{"name":"Board Crew","boardEnabled":true}`); status != http.StatusOK {
		t.Fatalf("board on: %d %v", status, body)
	}
	h.join(t, "bob", crew)
	h.join(t, "carol", crew)
	voice := h.voice(t, crew)
	board := func() map[string]map[string]any {
		t.Helper()
		status, body := h.call(t, "alice", http.MethodGet, crewPath(crew, "/members"), "")
		if status != http.StatusOK {
			t.Fatalf("members: %d %v", status, body)
		}
		rows, _ := body["board"].([]any)
		byName := map[string]map[string]any{}
		for i, row := range rows {
			line, _ := row.(map[string]any)
			line["rank"] = i
			name, _ := line["displayName"].(string)
			byName[name] = line
		}
		return byName
	}

	// A bad week is never permanent: last fortnight's ride is not on it.
	h.crewRide(t, "bob", crew, voice, time.Now().AddDate(0, 0, -14), 9000)
	if rows := board(); len(rows) != 0 {
		t.Fatalf("last fortnight's ride is on this week's board: %v", rows)
	}

	h.crewRide(t, "bob", crew, voice, time.Now(), 400)
	h.crewRide(t, "carol", crew, voice, time.Now(), 500)
	// Carol answered for one of the pair; bob has never been asked.
	if _, err := h.store.Pool.Exec(t.Context(),
		"update users set ftp_source = 'manual' where id = $1", h.users.ByToken["carol"].ID); err != nil {
		t.Fatalf("carol's answer: %v", err)
	}

	rows := board()
	bob, carol := rows[h.displayName(t, "bob")], rows[h.displayName(t, "carol")]
	if len(rows) != 2 || bob == nil || carol == nil {
		t.Fatalf("board = %v, want bob and carol", rows)
	}
	if carol["rank"] != 0 || bob["rank"] != 1 {
		t.Errorf("carol rode more this week and ranks %v, bob %v", carol["rank"], bob["rank"])
	}
	if bob["kj"] != float64(400) {
		t.Errorf("bob's week = %v kJ, want 400: only this week counts", bob["kj"])
	}
	if got, ok := bob["category"]; ok {
		t.Errorf("a rider who was never asked is published as %v", got)
	}
	if got := carol["category"]; got == nil || got == "" {
		t.Error("a rider who answered lost their category, which is not the rule")
	}
}
