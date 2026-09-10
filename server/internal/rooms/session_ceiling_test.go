package rooms

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

const ceilingWorkout = `{"name":"Openers","steps":[{"type":"steady","seconds":600,"target":0.75}]}`

// planBody is one POST to a room's schedule.
func planBody(startsAt time.Time) string {
	escaped := strings.ReplaceAll(ceilingWorkout, `"`, `\"`)
	return fmt.Sprintf(`{"workoutName":"Openers","workoutJson":"%s","startsAt":%q}`,
		escaped, startsAt.UTC().Format(time.RFC3339))
}

// seedPlans writes n upcoming plans straight to the store. The ceiling is
// what the handler is being asked about, so filling the room must not go
// through it.
func seedPlans(t *testing.T, h *harness, slug string, n int) []db.ScheduledSession {
	t.Helper()
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room %s: %v", slug, err)
	}
	alice := h.users.ByToken["alice"]
	out := make([]db.ScheduledSession, 0, n)
	for i := range n {
		row, err := h.store.Queries.CreateScheduledSession(t.Context(), db.CreateScheduledSessionParams{
			RoomID: room.ID, WorkoutName: fmt.Sprintf("Plan %d", i),
			WorkoutJson: []byte(ceilingWorkout),
			StartsAt:    pgTime(time.Now().Add(time.Duration(i+1) * time.Hour)),
			CreatedBy:   alice.ID,
		})
		if err != nil {
			t.Fatalf("seed plan %d: %v", i, err)
		}
		out = append(out, row)
	}
	return out
}

// docs/SPEC.md's 50-plan ceiling: the room fills, the next plan is refused
// with the 429 errors.md gives a ceiling, and cancelling one — or starting
// one — hands the slot back.
func TestThePlannedSessionCeiling(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Planners")
	seeded := seedPlans(t, h, slug, maxPlannedPerRoom-1)

	// One short of the ceiling still plans.
	status, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule", planBody(time.Now().Add(2*time.Hour)))
	if status != http.StatusCreated {
		t.Fatalf("plan at the ceiling: %d %v", status, body)
	}
	last, _ := body["id"].(string)

	status, body = h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule", planBody(time.Now().Add(3*time.Hour)))
	if status != http.StatusTooManyRequests {
		t.Fatalf("plan past the ceiling: %d %v, want 429", status, body)
	}
	if body["error"] != "rate_limited" {
		t.Errorf("machine code %v, want rate_limited", body["error"])
	}
	message, _ := body["message"].(string)
	if message == "" {
		t.Fatal("a refusal with no message is a bug (errors.md)")
	}
	if !strings.Contains(message, "50") {
		t.Errorf("message %q does not name the ceiling", message)
	}
	if strings.Contains(strings.ToLower(message), "try again") {
		t.Errorf("message %q sends the coach away to wait for a ceiling that never clears", message)
	}

	// The room still reads at the ceiling: the list is what the coach uses to
	// pick the one to cancel, so it must not be the thing that breaks.
	status, body = h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	upcoming, _ := body["upcoming"].([]any)
	if status != http.StatusOK || len(upcoming) != maxPlannedPerRoom {
		t.Fatalf("upcoming at the ceiling: %d, %d rows", status, len(upcoming))
	}

	// Cancelling makes room.
	if status, _ := h.call(t, "alice", http.MethodDelete, "/api/rooms/"+slug+"/schedule/"+last, ""); status != http.StatusNoContent {
		t.Fatalf("cancel at the ceiling: %d", status)
	}
	if status, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule", planBody(time.Now().Add(4*time.Hour))); status != http.StatusCreated {
		t.Fatalf("plan after cancelling: %d %v", status, body)
	}

	// So does starting one: the ceiling counts what the room still has
	// coming, exactly as ListRoomUpcoming does.
	started := store.UUIDString(seeded[0].ID)
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule/"+started+"/started", ""); status != http.StatusNoContent {
		t.Fatalf("mark started: %d", status)
	}
	if status, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule", planBody(time.Now().Add(5*time.Hour))); status != http.StatusCreated {
		t.Fatalf("plan after one started: %d %v", status, body)
	}
}

// A room that predates the ceiling keeps working: the list still shows every
// plan and cancelling is still open. Only planning refuses.
func TestARoomOverTheCeilingStillReadsAndCancels(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Overbooked")
	seeded := seedPlans(t, h, slug, maxPlannedPerRoom+7)

	status, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	upcoming, _ := body["upcoming"].([]any)
	if status != http.StatusOK || len(upcoming) != len(seeded) {
		t.Fatalf("upcoming over the ceiling: %d, %d of %d rows", status, len(upcoming), len(seeded))
	}
	if status, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule", planBody(time.Now().Add(2*time.Hour))); status != http.StatusTooManyRequests {
		t.Fatalf("plan over the ceiling: %d %v, want 429", status, body)
	}
	if status, _ := h.call(t, "alice", http.MethodDelete, "/api/rooms/"+slug+"/schedule/"+store.UUIDString(seeded[0].ID), ""); status != http.StatusNoContent {
		t.Fatalf("cancel over the ceiling: %d — the room is locked in", status)
	}
}

// The ceiling holds under a burst (#1413's lesson): the count runs with the
// room's row locked, in the transaction that inserts.
func TestThePlannedSessionCeilingHoldsUnderParallelPlans(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Racers")
	const room = 3
	seedPlans(t, h, slug, maxPlannedPerRoom-room)

	var wg sync.WaitGroup
	var mu sync.Mutex
	created := 0
	for i := range room * 3 {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule",
				planBody(time.Now().Add(time.Duration(i+2)*time.Hour)))
			mu.Lock()
			defer mu.Unlock()
			if status == http.StatusCreated {
				created++
			}
		}(i)
	}
	wg.Wait()
	if created != room {
		t.Fatalf("%d plans landed in %d slots", created, room)
	}
}

// The feeds are bounded at both ends (#1414). A plan beyond the horizon is
// not rendered — the ICS body is built in memory behind a bearer token, and
// nothing the product offers can plan past three months anyway.
func TestTheCalendarFeedsStopAtTheHorizon(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Horizon")
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}
	alice := h.users.ByToken["alice"]
	for name, at := range map[string]time.Time{
		"Inside":  time.Now().Add(60 * 24 * time.Hour),
		"Outside": time.Now().Add(calendarHorizon + 24*time.Hour),
	} {
		if _, err := h.store.Queries.CreateScheduledSession(t.Context(), db.CreateScheduledSessionParams{
			RoomID: room.ID, WorkoutName: name, WorkoutJson: []byte(ceilingWorkout),
			StartsAt: pgTime(at), CreatedBy: alice.ID,
		}); err != nil {
			t.Fatalf("seed %s: %v", name, err)
		}
	}

	_, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	token, _ := body["icsToken"].(string)
	status, ics, _ := h.rawGet(t, "/api/rooms/"+slug+"/calendar/"+token+".ics")
	if status != http.StatusOK {
		t.Fatalf("room feed: %d", status)
	}
	if !strings.Contains(ics, "SUMMARY:Inside") {
		t.Error("the room feed dropped a plan inside the horizon")
	}
	if strings.Contains(ics, "SUMMARY:Outside") {
		t.Error("the room feed rendered a plan past the horizon")
	}

	// The rider feed reads the same window through a different query.
	status, ics, _ = h.rawGet(t, "/api/calendar/"+alice.IcsToken+".ics")
	if status != http.StatusOK {
		t.Fatalf("rider feed: %d", status)
	}
	if !strings.Contains(ics, "SUMMARY:Inside") || strings.Contains(ics, "SUMMARY:Outside") {
		t.Error("the rider feed disagrees with the room feed about the horizon")
	}
}

// The row bound is in the query, not only in the constant the handler passes
// — proven by asking for two of many, which is the same lever the handler
// pulls with maxCalendarEvents.
func TestTheCalendarQueriesTakeARowBound(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Bounded")
	seedPlans(t, h, slug, 5)
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}
	alice := h.users.ByToken["alice"]
	from, until := pgTime(time.Now().Add(-calendarHistory)), calendarUntil()

	rows, err := h.store.Queries.ListRoomCalendar(t.Context(), db.ListRoomCalendarParams{
		RoomID: room.ID, StartsFrom: from, StartsUntil: until, RowLimit: 2,
	})
	if err != nil || len(rows) != 2 {
		t.Fatalf("room calendar: %d rows, %v", len(rows), err)
	}
	userRows, err := h.store.Queries.ListUserCalendar(t.Context(), db.ListUserCalendarParams{
		UserID: alice.ID, StartsFrom: from, StartsUntil: until, RowLimit: 2,
	})
	if err != nil || len(userRows) != 2 {
		t.Fatalf("rider calendar: %d rows, %v", len(userRows), err)
	}
}
