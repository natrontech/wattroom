package crews

// The bounds on a crew's plans: docs/SPEC.md's shelf, and the calendar
// feeds' window and row limit (#1414).

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// seedPlans writes n upcoming plans straight to the store, an hour apart and
// naming no channel. The ceiling is what the handler is being asked about, so
// filling the crew must not go through it.
func (h *harness) seedPlans(t *testing.T, crew db.GetCrewRow, n int) []db.ScheduledSession {
	t.Helper()
	alice := h.users.ByToken["alice"]
	out := make([]db.ScheduledSession, 0, n)
	for i := range n {
		row, err := h.store.Queries.CreateCrewPlan(t.Context(), db.CreateCrewPlanParams{
			CrewID: crew.ID, WorkoutName: fmt.Sprintf("Plan %d", i), WorkoutJson: []byte(planWorkout),
			StartsAt: pgTime(time.Now().Add(time.Duration(i+1) * time.Hour)), CreatedBy: alice.ID,
		})
		if err != nil {
			t.Fatalf("seed plan %d: %v", i, err)
		}
		out = append(out, row)
	}
	return out
}

// docs/SPEC.md's 100-plan shelf: one short still plans, full refuses with the
// 429 errors.md gives a ceiling and the number in the message, and cancelling
// one — or starting one — hands a slot back.
func TestTheCrewPlanCeiling(t *testing.T) {
	h := setup(t)
	crew, channel := h.crewWithChannel(t)
	seeded := h.seedPlans(t, crew, maxPlannedPerCrew-1)

	status, body := h.call(t, "bob", http.MethodPost, schedulePath(crew), crewPlanBody(time.Now().Add(2*time.Hour), ""))
	if status != http.StatusCreated {
		t.Fatalf("plan one short of the shelf: %d %v", status, body)
	}
	last, _ := body["id"].(string)

	status, body = h.call(t, "bob", http.MethodPost, schedulePath(crew), crewPlanBody(time.Now().Add(3*time.Hour), ""))
	if status != http.StatusTooManyRequests || body["error"] != "rate_limited" {
		t.Fatalf("past the shelf: %d %v, want 429 rate_limited", status, body)
	}
	message, _ := body["message"].(string)
	if message == "" {
		t.Fatal("a refusal with no message is a bug (errors.md)")
	}
	if !strings.Contains(message, "100") {
		t.Errorf("message %q does not name the ceiling", message)
	}
	if strings.Contains(strings.ToLower(message), "try again") {
		t.Errorf("message %q sends the planner away to wait for a ceiling that never clears", message)
	}

	// The schedule still reads at the ceiling: it is what the planner uses to
	// pick the one to cancel, so it must not be the thing that breaks.
	if got := len(h.crewSchedule(t, "alice", crew)); got != maxPlannedPerCrew {
		t.Fatalf("the schedule at the ceiling lists %d plans, want %d", got, maxPlannedPerCrew)
	}

	if status, _ := h.call(t, "alice", http.MethodDelete, schedulePath(crew, "/", last), ""); status != http.StatusNoContent {
		t.Fatalf("cancel: %d", status)
	}
	if status, body := h.call(t, "bob", http.MethodPost, schedulePath(crew), crewPlanBody(time.Now().Add(4*time.Hour), "")); status != http.StatusCreated {
		t.Fatalf("a cancel did not hand the slot back: %d %v", status, body)
	}

	// So does starting one: the shelf counts what the crew still has coming,
	// exactly as its schedule lists it.
	started := schedulePath(crew, "/", store.UUIDString(seeded[0].ID), "/started")
	if status, body := h.call(t, "alice", http.MethodPost, started, fmt.Sprintf(`{"channelId":%q}`, store.UUIDString(channel))); status != http.StatusOK {
		t.Fatalf("start: %d %v", status, body)
	}
	if status, body := h.call(t, "bob", http.MethodPost, schedulePath(crew), crewPlanBody(time.Now().Add(5*time.Hour), "")); status != http.StatusCreated {
		t.Fatalf("a start did not hand the slot back: %d %v", status, body)
	}
}

// A crew already over the shelf keeps working: the schedule still shows every
// plan and cancelling is still open. Only planning refuses.
func TestACrewOverTheCeilingStillReadsAndCancels(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Overbooked")
	seeded := h.seedPlans(t, crew, maxPlannedPerCrew+7)

	if got := len(h.crewSchedule(t, "alice", crew)); got != len(seeded) {
		t.Fatalf("the schedule over the ceiling lists %d of %d plans", got, len(seeded))
	}
	if status, body := h.call(t, "alice", http.MethodPost, schedulePath(crew), crewPlanBody(time.Now().Add(2*time.Hour), "")); status != http.StatusTooManyRequests {
		t.Fatalf("plan over the ceiling: %d %v, want 429", status, body)
	}
	if status, _ := h.call(t, "alice", http.MethodDelete, schedulePath(crew, "/", store.UUIDString(seeded[0].ID)), ""); status != http.StatusNoContent {
		t.Fatalf("cancel over the ceiling: %d — the crew is locked in", status)
	}
}

// The ceiling holds under a burst (#1413's lesson): the count runs with the
// crew's row locked, in the transaction that inserts.
func TestTheCrewPlanCeilingHoldsUnderParallelPlans(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Racers")
	const slots = 3
	h.seedPlans(t, crew, maxPlannedPerCrew-slots)

	var wg sync.WaitGroup
	var mu sync.Mutex
	created := 0
	for i := range slots * 3 {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			status, _ := h.call(t, "alice", http.MethodPost, schedulePath(crew),
				crewPlanBody(time.Now().Add(time.Duration(i+2)*time.Hour), ""))
			mu.Lock()
			defer mu.Unlock()
			if status == http.StatusCreated {
				created++
			}
		}(i)
	}
	wg.Wait()
	if created != slots {
		t.Fatalf("%d plans landed in %d slots", created, slots)
	}
}

// The feeds are bounded at both ends (#1414). A plan beyond the horizon is
// not rendered — the ICS body is built in memory behind a bearer token, and
// nothing the product offers can plan past three months anyway.
func TestTheCalendarFeedsStopAtTheHorizon(t *testing.T) {
	h := setup(t)
	crew, _ := h.crewWithChannel(t)
	alice := h.users.ByToken["alice"]
	for name, at := range map[string]time.Time{
		"Inside":  time.Now().Add(60 * 24 * time.Hour),
		"Outside": time.Now().Add(calendarHorizon + 24*time.Hour),
	} {
		if _, err := h.store.Queries.CreateCrewPlan(t.Context(), db.CreateCrewPlanParams{
			CrewID: crew.ID, WorkoutName: name, WorkoutJson: []byte(planWorkout),
			StartsAt: pgTime(at), CreatedBy: alice.ID,
		}); err != nil {
			t.Fatalf("seed %s: %v", name, err)
		}
	}

	status, ics, _ := h.rawGet(t, crewPath(crew, "/calendar/", crew.IcsToken, ".ics"))
	if status != http.StatusOK {
		t.Fatalf("crew feed: %d", status)
	}
	if !strings.Contains(ics, "SUMMARY:Inside") {
		t.Error("the crew feed dropped a plan inside the horizon")
	}
	if strings.Contains(ics, "SUMMARY:Outside") {
		t.Error("the crew feed rendered a plan past the horizon")
	}

	// The rider feed reads the same window through a different query.
	status, ics, _ = h.rawGet(t, "/api/calendar/"+alice.IcsToken+".ics")
	if status != http.StatusOK {
		t.Fatalf("rider feed: %d", status)
	}
	if !strings.Contains(ics, "SUMMARY:Inside") || strings.Contains(ics, "SUMMARY:Outside") {
		t.Error("the rider feed disagrees with the crew feed about the horizon")
	}
}

// The row bound is in the query, not only in the constant the handler passes
// — proven by asking for two of many, which is the same lever the handler
// pulls with maxCalendarEvents.
func TestTheCalendarQueriesTakeARowBound(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Bounded")
	h.seedPlans(t, crew, 5)
	alice := h.users.ByToken["alice"]
	from, until := pgTime(time.Now().Add(-calendarHistory)), calendarUntil()

	rows, err := h.store.Queries.ListCrewCalendar(t.Context(), db.ListCrewCalendarParams{
		CrewID: crew.ID, StartsFrom: from, StartsUntil: until, RowLimit: 2,
	})
	if err != nil || len(rows) != 2 {
		t.Fatalf("crew calendar: %d rows, %v", len(rows), err)
	}
	userRows, err := h.store.Queries.ListUserCalendar(t.Context(), db.ListUserCalendarParams{
		UserID: alice.ID, StartsFrom: from, StartsUntil: until, RowLimit: 2,
	})
	if err != nil || len(userRows) != 2 {
		t.Fatalf("rider calendar: %d rows, %v", len(userRows), err)
	}
}
