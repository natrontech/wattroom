package rooms

// The crew's schedule — the tests for crew_schedule.go (#2440), ported from
// the room's (schedule_test.go, session_ceiling_test.go) onto the crew.

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// crewWithChannel is alice's crew with bob in it and one open voice channel,
// the shape every test below starts from.
func (h *harness) crewWithChannel(t *testing.T) (db.GetCrewRow, pgtype.UUID) {
	t.Helper()
	slug, code := h.createRoom(t, "alice", "Planners")
	crew := h.crewOf(t, slug)
	h.joinCrew(t, "bob", code)
	return crew, h.channel(t, crew, "voice", "Pain Cave", false)
}

func schedulePath(crew db.GetCrewRow, rest ...string) string {
	return "/api/crews/" + store.UUIDString(crew.ID) + "/schedule" + strings.Join(rest, "")
}

// crewPlanBody is one POST to the crew's schedule; channel "" names none.
func crewPlanBody(startsAt time.Time, channel string) string {
	escaped := strings.ReplaceAll(ceilingWorkout, `"`, `\"`)
	return fmt.Sprintf(`{"workoutName":"Openers","workoutJson":"%s","startsAt":%q,"channelId":%q}`,
		escaped, startsAt.UTC().Format(time.RFC3339), channel)
}

// crewSchedule is the caller's view of the crew's calendar, by plan id.
func (h *harness) crewSchedule(t *testing.T, who string, crew db.GetCrewRow) map[string]map[string]any {
	t.Helper()
	status, body := h.call(t, who, http.MethodGet, schedulePath(crew), "")
	if status != http.StatusOK {
		t.Fatalf("%s reads the schedule: %d %v", who, status, body)
	}
	out := map[string]map[string]any{}
	list, _ := body["sessions"].([]any)
	for _, item := range list {
		entry, _ := item.(map[string]any)
		id, _ := entry["id"].(string)
		out[id] = entry
	}
	return out
}

func TestCrewScheduleLifecycle(t *testing.T) {
	h := setup(t)
	notifier := &fakeNotifier{}
	h.svc.SetNotifier(notifier)
	crew, channel := h.crewWithChannel(t)
	h.joinCrew(t, "carol", codeOf(crew.Code))
	cave := store.UUIDString(channel)

	// Any member plans (SPEC roles matrix), naming a voice channel.
	status, body := h.call(t, "bob", http.MethodPost, schedulePath(crew), crewPlanBody(time.Now().Add(2*time.Hour), cave))
	if status != http.StatusCreated {
		t.Fatalf("a member's plan: %d %v", status, body)
	}
	plan, _ := body["id"].(string)
	// The mail names the crew and the channel (#2440).
	if mails := notifier.plans(t); len(mails) != 1 || mails[0].crew != crew.ID || mails[0].channel != channel {
		t.Errorf("the plan mail named %+v, want the crew and Pain Cave", mails)
	}

	// Validation at the boundary: the past, and a channel that is not one of
	// this crew's voice channels, each name their field.
	if status, body := h.call(t, "bob", http.MethodPost, schedulePath(crew), crewPlanBody(time.Now().Add(-2*time.Hour), "")); status != http.StatusBadRequest || body["field"] != "startsAt" {
		t.Errorf("a past plan: %d %v", status, body)
	}
	text := store.UUIDString(h.channel(t, crew, "text", "general", false))
	for _, bad := range []string{text, "not-a-uuid", "00000000-0000-0000-0000-000000000000"} {
		if status, body := h.call(t, "bob", http.MethodPost, schedulePath(crew), crewPlanBody(time.Now().Add(time.Hour), bad)); status != http.StatusBadRequest || body["field"] != "channelId" {
			t.Errorf("a plan naming %q: %d %v", bad, status, body)
		}
	}

	// It is on the crew's calendar, with its channel, and it is bob's own.
	if entry := h.crewSchedule(t, "alice", crew)[plan]; entry == nil || entry["channelName"] != "Pain Cave" || entry["mine"] != nil {
		t.Fatalf("alice reads %v", entry)
	}
	if entry := h.crewSchedule(t, "bob", crew)[plan]; entry["mine"] != true {
		t.Errorf("bob's own plan does not say so: %v", entry)
	}
	// Outside the crew there is no calendar, and no session is no read at all.
	if status, _ := h.call(t, "", http.MethodGet, schedulePath(crew), ""); status != http.StatusUnauthorized {
		t.Errorf("signed out: %d", status)
	}

	// Move and cancel: the owner any plan, a member their own (SPEC).
	later := fmt.Sprintf(`{"startsAt":%q}`, time.Now().Add(4*time.Hour).UTC().Format(time.RFC3339))
	if status, _ := h.call(t, "carol", http.MethodPatch, schedulePath(crew, "/", plan), later); status != http.StatusForbidden {
		t.Errorf("carol moved bob's plan: %d", status)
	}
	if status, _ := h.call(t, "alice", http.MethodPatch, schedulePath(crew, "/", plan), later); status != http.StatusNoContent {
		t.Errorf("the owner could not move it: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPatch, schedulePath(crew, "/", plan),
		fmt.Sprintf(`{"startsAt":%q}`, time.Now().Add(5*time.Hour).UTC().Format(time.RFC3339))); status != http.StatusNoContent {
		t.Errorf("bob could not move his own: %d", status)
	}
	if moved := notifier.movedTo(t); len(moved) != 2 {
		t.Errorf("two moves mailed %d times", len(moved))
	}
	if status, _ := h.call(t, "alice", http.MethodPatch, schedulePath(crew, "/00000000-0000-0000-0000-000000000000"), later); status != http.StatusNotFound {
		t.Errorf("an unknown plan: %d", status)
	}
	if status, _ := h.call(t, "carol", http.MethodDelete, schedulePath(crew, "/", plan), ""); status != http.StatusForbidden {
		t.Errorf("carol cancelled bob's plan: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodDelete, schedulePath(crew, "/", plan), ""); status != http.StatusNoContent {
		t.Errorf("bob could not cancel his own: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodDelete, schedulePath(crew, "/", plan), ""); status != http.StatusNotFound {
		t.Errorf("a second cancel: %d", status)
	}
	if sent := notifier.sent(t); len(sent) != 1 {
		t.Errorf("the cancel mailed %d times", len(sent))
	}
}

// A plan naming a private channel is that channel's (#2440): to a member it
// does not admit, it is not on the calendar, cannot be answered, and does
// not count them among who has not answered.
func TestAPlanInAPrivateChannelIsItsPeoples(t *testing.T) {
	h := setup(t)
	crew, _ := h.crewWithChannel(t)
	h.joinCrew(t, "carol", codeOf(crew.Code))
	coaches := store.UUIDString(h.channel(t, crew, "voice", "Coaches", true))

	status, body := h.call(t, "alice", http.MethodPost, schedulePath(crew), crewPlanBody(time.Now().Add(time.Hour), coaches))
	if status != http.StatusCreated {
		t.Fatalf("plan: %d %v", status, body)
	}
	plan, _ := body["id"].(string)
	if _, seen := h.crewSchedule(t, "bob", crew)[plan]; seen {
		t.Error("a member the channel does not admit sees its plan")
	}
	if status, _ := h.call(t, "bob", http.MethodPut, schedulePath(crew, "/", plan, "/rsvp"), ""); status != http.StatusNotFound {
		t.Errorf("bob answered a plan he cannot see: %d", status)
	}
	// Named into it, carol sees it — and alice's count of who has not
	// answered is the channel's people, not the crew.
	if _, err := h.store.Pool.Exec(t.Context(), "insert into channel_members (channel_id, user_id) values ($1, $2)",
		coaches, h.users.ByToken["carol"].ID); err != nil {
		t.Fatalf("name carol: %v", err)
	}
	if entry := h.crewSchedule(t, "carol", crew)[plan]; entry == nil {
		t.Fatal("named in, carol still cannot see the plan")
	}
	if entry := h.crewSchedule(t, "alice", crew)[plan]; count(t, entry, "unanswered") != 2 {
		t.Errorf("unanswered = %v, want 2 (alice and carol, not bob)", entry["unanswered"])
	}
	// Planning into a private channel the planner cannot enter is refused
	// like a channel that is not there.
	if status, body := h.call(t, "bob", http.MethodPost, schedulePath(crew), crewPlanBody(time.Now().Add(time.Hour), coaches)); status != http.StatusBadRequest || body["field"] != "channelId" {
		t.Errorf("bob planned into a channel he cannot enter: %d %v", status, body)
	}
}

// The RSVP ported (#450, #1011, #1675): an in is named, an out is counted,
// the rest have not answered — and someone the crew banned is not coming.
func TestCrewRsvp(t *testing.T) {
	h := setup(t)
	crew, channel := h.crewWithChannel(t)
	h.joinCrew(t, "carol", codeOf(crew.Code))
	_, body := h.call(t, "alice", http.MethodPost, schedulePath(crew), crewPlanBody(time.Now().Add(time.Hour), store.UUIDString(channel)))
	plan, _ := body["id"].(string)
	rsvp := schedulePath(crew, "/", plan, "/rsvp")

	if status, _ := h.call(t, "bob", http.MethodPut, rsvp, ""); status != http.StatusNoContent {
		t.Fatalf("bob in: %d", status)
	}
	if status, _ := h.call(t, "carol", http.MethodPut, rsvp, `{"going":false}`); status != http.StatusNoContent {
		t.Fatalf("carol out: %d", status)
	}
	entry := h.crewSchedule(t, "alice", crew)[plan]
	going, _ := entry["going"].([]any)
	if len(going) != 1 || count(t, entry, "out") != 1 || count(t, entry, "unanswered") != 1 {
		t.Fatalf("going %v out %v unanswered %v, want bob in, one out, alice unanswered", going, entry["out"], entry["unanswered"])
	}
	if mine := h.crewSchedule(t, "carol", crew)[plan]; mine["yourAnswer"] != "out" {
		t.Errorf("carol's own answer reads %v", mine["yourAnswer"])
	}
	if status, _ := h.call(t, "carol", http.MethodDelete, rsvp, ""); status != http.StatusNoContent {
		t.Fatalf("carol takes it back: %d", status)
	}
	h.banFromCrew(t, crew, "bob")
	entry = h.crewSchedule(t, "alice", crew)[plan]
	if going, _ := entry["going"].([]any); len(going) != 0 {
		t.Errorf("a banned rider is still listed as coming: %v", going)
	}
}

// sessionOpener is the hub as the start sees it: which channel was opened by
// whom, and a coach already holding a channel refuses anyone else.
type sessionOpener struct {
	fakePresence
	mu      sync.Mutex
	coaches map[string]string
}

func (o *sessionOpener) OpenSession(channel string, rider protocol.Rider, _, _ string) (string, string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if coach, busy := o.coaches[channel]; busy && coach != rider.ID {
		return "conflict", coach + " is coaching a session in this channel — one runs here at a time."
	}
	o.coaches[channel] = rider.ID
	return "", ""
}

// Starting a plan opens its session in its channel (#2440): a plan that names
// none asks for one, a channel another coach holds refuses naming them, and a
// plan starts once.
func TestStartingACrewPlan(t *testing.T) {
	h := setup(t)
	opener := &sessionOpener{coaches: map[string]string{}}
	h.svc.SetPresence(opener)
	crew, channel := h.crewWithChannel(t)
	cave := store.UUIDString(channel)

	_, body := h.call(t, "bob", http.MethodPost, schedulePath(crew), crewPlanBody(time.Now().Add(10*time.Minute), ""))
	unassigned, _ := body["id"].(string)
	if status, body := h.call(t, "bob", http.MethodPost, schedulePath(crew, "/", unassigned, "/started"), ""); status != http.StatusBadRequest || body["field"] != "channelId" {
		t.Fatalf("a plan with no channel started without one: %d %v", status, body)
	}
	status, body := h.call(t, "bob", http.MethodPost, schedulePath(crew, "/", unassigned, "/started"), fmt.Sprintf(`{"channelId":%q}`, cave))
	if status != http.StatusOK || body["channelId"] != cave {
		t.Fatalf("start in Pain Cave: %d %v", status, body)
	}
	if coach := opener.coaches[cave]; coach != h.userID(t, "bob") {
		t.Errorf("the session opened for %q, want bob", coach)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, schedulePath(crew, "/", unassigned, "/started"), ""); status != http.StatusConflict {
		t.Errorf("a second start: %d", status)
	}
	if _, seen := h.crewSchedule(t, "bob", crew)[unassigned]; seen {
		t.Error("a started plan is still offered")
	}

	// Alice's plan names the same channel, which bob is coaching now.
	_, body = h.call(t, "alice", http.MethodPost, schedulePath(crew), crewPlanBody(time.Now().Add(10*time.Minute), cave))
	busy, _ := body["id"].(string)
	status, body = h.call(t, "alice", http.MethodPost, schedulePath(crew, "/", busy, "/started"), "")
	if status != http.StatusConflict || !strings.Contains(fmt.Sprint(body["message"]), h.userID(t, "bob")) {
		t.Fatalf("a start into a busy channel: %d %v, want 409 naming the coach", status, body)
	}
	// Refused, it is still planned — nothing marked it started.
	if _, seen := h.crewSchedule(t, "alice", crew)[busy]; !seen {
		t.Error("a refused start took the plan off the calendar")
	}
}

// docs/SPEC.md's 100-plan shelf: full, the next plan is refused with the 429
// a ceiling takes and the number in the message; a cancel hands a slot back.
func TestTheCrewPlanCeiling(t *testing.T) {
	h := setup(t)
	crew, _ := h.crewWithChannel(t)
	alice := h.users.ByToken["alice"]
	var last pgtype.UUID
	for i := range maxPlannedPerCrew {
		row, err := h.store.Queries.CreateCrewPlan(t.Context(), db.CreateCrewPlanParams{
			CrewID: crew.ID, WorkoutName: fmt.Sprintf("Plan %d", i), WorkoutJson: []byte(ceilingWorkout),
			StartsAt: pgTime(time.Now().Add(time.Duration(i+1) * time.Hour)), CreatedBy: alice.ID,
		})
		if err != nil {
			t.Fatalf("seed %d: %v", i, err)
		}
		last = row.ID
	}
	status, body := h.call(t, "bob", http.MethodPost, schedulePath(crew), crewPlanBody(time.Now().Add(time.Hour), ""))
	if status != http.StatusTooManyRequests || body["error"] != "rate_limited" || !strings.Contains(fmt.Sprint(body["message"]), "100") {
		t.Fatalf("past the shelf: %d %v", status, body)
	}
	if status, _ := h.call(t, "alice", http.MethodDelete, schedulePath(crew, "/", store.UUIDString(last)), ""); status != http.StatusNoContent {
		t.Fatalf("cancel: %d", status)
	}
	if status, body := h.call(t, "bob", http.MethodPost, schedulePath(crew), crewPlanBody(time.Now().Add(time.Hour), "")); status != http.StatusCreated {
		t.Fatalf("a cancel did not hand the slot back: %d %v", status, body)
	}
}

// Home's "What's next" is every crew the rider is in (#325, #2440), with the
// channels they may enter.
func TestMyScheduleIsEveryCrewsPlans(t *testing.T) {
	h := setup(t)
	crew, channel := h.crewWithChannel(t)
	coaches := store.UUIDString(h.channel(t, crew, "voice", "Coaches", true))
	for _, where := range []string{store.UUIDString(channel), coaches} {
		if status, body := h.call(t, "alice", http.MethodPost, schedulePath(crew), crewPlanBody(time.Now().Add(time.Hour), where)); status != http.StatusCreated {
			t.Fatalf("plan: %d %v", status, body)
		}
	}
	_, body := h.call(t, "bob", http.MethodGet, "/api/schedule", "")
	list, _ := body["sessions"].([]any)
	var mine []map[string]any
	for _, item := range list {
		if entry, _ := item.(map[string]any); entry["crewId"] == store.UUIDString(crew.ID) {
			mine = append(mine, entry)
		}
	}
	if len(mine) != 1 || mine[0]["channelName"] != "Pain Cave" || mine[0]["crewName"] != crew.Name {
		t.Fatalf("bob's schedule: %v, want the Pain Cave plan alone, named for the crew", mine)
	}
}
