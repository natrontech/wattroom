package rooms

// Planned sessions and RSVPs — the tests for schedule.go, split out of
// rooms_test.go (consolidation sweep 2026-09-09).

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"
)

func TestScheduleLifecycle(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Planners")
	h.enter(t, "bob", code, slug)

	workout := `{\"name\":\"Openers\",\"steps\":[{\"type\":\"steady\",\"seconds\":600,\"target\":0.75}]}`
	starts := time.Now().Add(2 * time.Hour).UTC().Format(time.RFC3339)
	plan := fmt.Sprintf(`{"workoutName":"Openers","workoutJson":"%s","startsAt":%q}`, workout, starts)

	// A plain member cannot plan; the owner can.
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/schedule", plan); status != http.StatusForbidden {
		t.Fatalf("member schedule: %d", status)
	}
	status, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule", plan)
	if status != http.StatusCreated {
		t.Fatalf("schedule: %d %v", status, body)
	}
	planID, _ := body["id"].(string)

	// The past bounces with the field named.
	past := fmt.Sprintf(`{"workoutName":"Openers","workoutJson":"%s","startsAt":%q}`,
		workout, time.Now().Add(-2*time.Hour).UTC().Format(time.RFC3339))
	if status, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule", past); status != http.StatusBadRequest || body["field"] != "startsAt" {
		t.Fatalf("past plan: %d %v", status, body)
	}

	// Members see it on the room; a coach (promoted bob) can remove it.
	status, body = h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	upcoming, _ := body["upcoming"].([]any)
	if status != http.StatusOK || len(upcoming) != 1 {
		t.Fatalf("upcoming: %d %v", status, body)
	}
	// The rooms list shows the next session.
	status, body = h.call(t, "bob", http.MethodGet, "/api/rooms", "")
	roomsList, _ := body["rooms"].([]any)
	found := false
	for _, entry := range roomsList {
		m, _ := entry.(map[string]any)
		if m["slug"] == slug {
			next, _ := m["nextSession"].(map[string]any)
			found = next["workoutName"] == "Openers"
		}
	}
	if status != http.StatusOK || !found {
		t.Fatalf("nextSession missing: %d %v", status, body)
	}

	// Moving the plan (#258): members cannot, the owner can, the past and
	// unknown ids bounce, and the room shows the new time.
	newStart := time.Now().Add(4 * time.Hour).UTC().Format(time.RFC3339)
	move := fmt.Sprintf(`{"startsAt":%q}`, newStart)
	if status, _ := h.call(t, "bob", http.MethodPatch, "/api/rooms/"+slug+"/schedule/"+planID, move); status != http.StatusForbidden {
		t.Fatalf("member reschedule: %d", status)
	}
	if status, body := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug+"/schedule/"+planID,
		fmt.Sprintf(`{"startsAt":%q}`, time.Now().Add(-2*time.Hour).UTC().Format(time.RFC3339))); status != http.StatusBadRequest || body["field"] != "startsAt" {
		t.Fatalf("past reschedule: %d %v", status, body)
	}
	if status, _ := h.call(t, "alice", http.MethodPatch,
		"/api/rooms/"+slug+"/schedule/00000000-0000-0000-0000-000000000000", move); status != http.StatusNotFound {
		t.Fatalf("unknown plan reschedule: %d", status)
	}
	if status, _ := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug+"/schedule/"+planID, move); status != http.StatusNoContent {
		t.Fatalf("reschedule: %d", status)
	}
	status, body = h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	upcoming, _ = body["upcoming"].([]any)
	moved, _ := upcoming[0].(map[string]any)
	got, _ := time.Parse(time.RFC3339, fmt.Sprint(moved["startsAt"]))
	want, _ := time.Parse(time.RFC3339, newStart)
	if status != http.StatusOK || !got.Equal(want) {
		t.Fatalf("moved time not visible: %d got %v want %v", status, got, want)
	}

	if status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/role",
		fmt.Sprintf(`{"userId":%q,"role":"coach"}`, h.userID(t, "bob"))); status != http.StatusNoContent {
		t.Fatalf("promote bob: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodDelete, "/api/rooms/"+slug+"/schedule/"+planID, ""); status != http.StatusNoContent {
		t.Fatalf("coach unschedule: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodDelete, "/api/rooms/"+slug+"/schedule/"+planID, ""); status != http.StatusNotFound {
		t.Fatalf("double unschedule: %d", status)
	}
}

// A planned session with an RSVP is what #450 calls an event: any member can
// say they are in, the room shows who, and saying it twice says it once.
func TestSessionRsvp(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Event Room")
	h.enter(t, "bob", code, slug)
	workout := `{\"name\":\"Openers\",\"steps\":[{\"type\":\"steady\",\"seconds\":600,\"target\":0.75}]}`
	status, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule",
		fmt.Sprintf(`{"workoutName":"Openers","workoutJson":"%s","startsAt":%q}`,
			workout, time.Now().Add(2*time.Hour).UTC().Format(time.RFC3339)))
	if status != http.StatusCreated {
		t.Fatalf("schedule: %d %v", status, body)
	}
	planID, _ := body["id"].(string)
	rsvp := "/api/rooms/" + slug + "/schedule/" + planID + "/rsvp"

	// Signed out, a stranger, and an unknown plan all bounce.
	if status, _ := h.call(t, "", http.MethodPut, rsvp, ""); status != http.StatusUnauthorized {
		t.Fatalf("signed out rsvp: %d", status)
	}
	if status, _ := h.call(t, "carol", http.MethodPut, rsvp, ""); status != http.StatusForbidden {
		t.Fatalf("stranger rsvp: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPut,
		"/api/rooms/"+slug+"/schedule/00000000-0000-0000-0000-000000000000/rsvp", ""); status != http.StatusNotFound {
		t.Fatalf("unknown plan rsvp: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPut, "/api/rooms/"+slug+"/schedule/not-a-uuid/rsvp", ""); status != http.StatusNotFound {
		t.Fatalf("malformed plan rsvp: %d", status)
	}

	// Bob is in, twice — and the room says so once.
	for range 2 {
		if status, _ := h.call(t, "bob", http.MethodPut, rsvp, ""); status != http.StatusNoContent {
			t.Fatalf("rsvp: %d", status)
		}
	}
	going := h.going(t, slug)
	if len(going) != 1 {
		t.Fatalf("going after rsvp: %v", going)
	}
	who, _ := going[0].(map[string]any)
	if who["id"] != h.userID(t, "bob") || who["displayName"] == "" {
		t.Fatalf("going names the wrong rider: %v", who)
	}

	// Taking it back empties the list; taking it back twice is not an error.
	for range 2 {
		if status, _ := h.call(t, "bob", http.MethodDelete, rsvp, ""); status != http.StatusNoContent {
			t.Fatalf("un-rsvp: %d", status)
		}
	}
	if going := h.going(t, slug); len(going) != 0 {
		t.Fatalf("going after cancel: %v", going)
	}
}

// Someone removed since they said yes is not coming (#1675): a crew ban
// takes the room memberships and used to leave the name on the card.
func TestARemovedMemberIsNotComing(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Event Room Removal")
	h.enter(t, "bob", code, slug)
	workout := `{\"name\":\"Openers\",\"steps\":[{\"type\":\"steady\",\"seconds\":600,\"target\":0.75}]}`
	status, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule",
		fmt.Sprintf(`{"workoutName":"Openers","workoutJson":"%s","startsAt":%q}`,
			workout, time.Now().Add(2*time.Hour).UTC().Format(time.RFC3339)))
	if status != http.StatusCreated {
		t.Fatalf("schedule: %d %v", status, body)
	}
	planID, _ := body["id"].(string)
	if status, _ := h.call(t, "bob", http.MethodPut, "/api/rooms/"+slug+"/schedule/"+planID+"/rsvp", ""); status != http.StatusNoContent {
		t.Fatalf("rsvp: %d", status)
	}
	if going := h.going(t, slug); len(going) != 1 {
		t.Fatalf("going after rsvp: %v — test proves nothing", going)
	}
	if status, _ := h.call(t, "alice", http.MethodDelete, "/api/rooms/"+slug+"/members/"+h.userID(t, "bob"), ""); status != http.StatusNoContent {
		t.Fatalf("remove: %d", status)
	}
	if going := h.going(t, slug); len(going) != 0 {
		t.Errorf("a removed member is still coming: %v", going)
	}
}

// A crew ban whose room sweep did not run still shuts the coach's door
// (#1763): the role row is not the last word, isBanned is.
func TestACrewBannedCoachCannotPlan(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Crew Banned Coach")
	h.enter(t, "bob", code, slug)
	if _, err := h.store.Pool.Exec(t.Context(), "update memberships set role = 'coach' where room_id = $1 and user_id = $2",
		roomID(t, h, slug), h.users.ByToken["bob"].ID); err != nil {
		t.Fatalf("coach: %v", err)
	}
	body := `{"workoutName":"Openers","workoutJson":"{\"name\":\"Openers\",\"steps\":[{\"type\":\"steady\",\"seconds\":600,\"target\":0.75}]}","startsAt":"` + time.Now().Add(2*time.Hour).UTC().Format(time.RFC3339) + `"}`
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/schedule", body); status != http.StatusCreated {
		t.Fatalf("a coach plans: %d", status)
	}
	// The ban row alone, with the membership left as the sweep would have
	// left it had the statement failed.
	crew := h.crewOf(t, slug)
	if _, err := h.store.Pool.Exec(t.Context(), "insert into crew_roles (crew_id, user_id, role) values ($1, $2, 'banned') on conflict (crew_id, user_id) do update set role = 'banned'", crew.ID, h.users.ByToken["bob"].ID); err != nil {
		t.Fatalf("ban row: %v", err)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/schedule", body); status != http.StatusForbidden {
		t.Fatalf("a crew-banned coach plans: %d, want 403", status)
	}
}

// count reads one of the plan's answer tallies. Absent is zero: the counts
// are omitempty, so "nobody is out" is a field that is not there.
func count(t *testing.T, plan map[string]any, key string) int {
	t.Helper()
	n, ok := plan[key].(float64)
	if !ok && plan[key] != nil {
		t.Fatalf("%s is not a number: %v", key, plan[key])
	}
	return int(n)
}

// The third state (#1011): "said no" is a row that says no, and only the
// absence of a row means nobody has answered. The room reads a decline as a
// COUNT — who is in is named, who is out is a number, because the number is
// what tells a planner whether to hold the session and the names would only
// add the pressure.
func TestSessionDecline(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Decline Room")
	h.enter(t, "bob", code, slug)
	h.enter(t, "carol", code, slug)
	workout := `{\"name\":\"Openers\",\"steps\":[{\"type\":\"steady\",\"seconds\":600,\"target\":0.75}]}`
	status, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule",
		fmt.Sprintf(`{"workoutName":"Openers","workoutJson":"%s","startsAt":%q}`,
			workout, time.Now().Add(2*time.Hour).UTC().Format(time.RFC3339)))
	if status != http.StatusCreated {
		t.Fatalf("schedule: %d %v", status, body)
	}
	rsvp := "/api/rooms/" + slug + "/schedule/" + fmt.Sprint(body["id"]) + "/rsvp"

	// Three members, nobody has answered — which is three unanswered and no
	// "out" field at all.
	plan := h.plan(t, "alice", slug)
	if got := count(t, plan, "unanswered"); got != 3 {
		t.Fatalf("unanswered before anyone answers: %d, want 3 — %v", got, plan)
	}

	// Bob says no. He is not in the list, he is one of the "out", and the
	// room is down to two who have not answered.
	if status, body := h.call(t, "bob", http.MethodPut, rsvp, `{"going":false}`); status != http.StatusNoContent {
		t.Fatalf("decline: %d %v", status, body)
	}
	plan = h.plan(t, "alice", slug)
	if going, _ := plan["going"].([]any); len(going) != 0 {
		t.Fatalf("a decline joined the who-is-in line: %v", going)
	}
	if out, un := count(t, plan, "out"), count(t, plan, "unanswered"); out != 1 || un != 2 {
		t.Fatalf("after one decline: %d out, %d unanswered, want 1 and 2 — %v", out, un, plan)
	}
	// The decision this implements, asserted rather than described: the plan
	// carries the number and NOT the name. Marshalled whole, because a
	// decline leaking through some other field is the failure to catch.
	seen, err := json.Marshal(plan)
	if err != nil {
		t.Fatalf("marshal the plan: %v", err)
	}
	if bytes.Contains(seen, []byte(h.userID(t, "bob"))) {
		t.Errorf("the room named who declined: %s", seen)
	}
	// Bob's own copy tells him where he stands — nobody else's does.
	if mine := h.plan(t, "bob", slug)["yourAnswer"]; mine != "out" {
		t.Errorf("a decliner cannot see their own answer: %v", mine)
	}
	if theirs := h.plan(t, "carol", slug)["yourAnswer"]; theirs != nil {
		t.Errorf("carol was handed an answer she never gave: %v", theirs)
	}

	// Changing your mind is free and takes no take-back first: one PUT.
	if status, _ := h.call(t, "bob", http.MethodPut, rsvp, `{"going":true}`); status != http.StatusNoContent {
		t.Fatalf("change of mind: %d", status)
	}
	plan = h.plan(t, "bob", slug)
	if going, _ := plan["going"].([]any); len(going) != 1 || plan["yourAnswer"] != "in" {
		t.Fatalf("a rider who changed their mind is not in: %v", plan)
	}
	if out, un := count(t, plan, "out"), count(t, plan, "unanswered"); out != 0 || un != 2 {
		t.Fatalf("after the change of mind: %d out, %d unanswered, want 0 and 2 — %v", out, un, plan)
	}

	// A PUT with no body is the spelling the app used before declines
	// existed, and it still means "in" — a tab loaded before the deploy.
	if status, _ := h.call(t, "carol", http.MethodPut, rsvp, ""); status != http.StatusNoContent {
		t.Fatalf("body-less rsvp: %d", status)
	}
	if answer := h.plan(t, "carol", slug)["yourAnswer"]; answer != "in" {
		t.Fatalf("a body-less PUT stopped meaning in: %v", answer)
	}

	// Taking the answer back is the third state again, from either side.
	if status, _ := h.call(t, "bob", http.MethodDelete, rsvp, ""); status != http.StatusNoContent {
		t.Fatalf("take it back: %d", status)
	}
	plan = h.plan(t, "bob", slug)
	if plan["yourAnswer"] != nil || count(t, plan, "unanswered") != 2 {
		t.Fatalf("taking an answer back did not leave it unanswered: %v", plan)
	}

	// A body that is not an answer is a 400 and changes nothing (errors.md).
	for _, bad := range []string{`{"going":"nope"}`, `{"coming":false}`, `not json`} {
		if status, body := h.call(t, "bob", http.MethodPut, rsvp, bad); status != http.StatusBadRequest || body["error"] != "invalid_request" {
			t.Errorf("%s: %d %v, want 400 invalid_request", bad, status, body)
		}
	}
	if plan := h.plan(t, "bob", slug); plan["yourAnswer"] != nil {
		t.Errorf("a refused body wrote an answer anyway: %v", plan)
	}
}

// A moved session asks the people who said no again (#1011), on the same
// condition as the reminder's own re-arm: a move to the time it already had
// is not a move.
func TestAMoveAsksTheDeclinersAgain(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Moving Room")
	h.enter(t, "bob", code, slug)
	h.enter(t, "carol", code, slug)
	workout := `{\"name\":\"Openers\",\"steps\":[{\"type\":\"steady\",\"seconds\":600,\"target\":0.75}]}`
	starts := time.Now().Add(2 * time.Hour).UTC().Format(time.RFC3339)
	status, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule",
		fmt.Sprintf(`{"workoutName":"Openers","workoutJson":"%s","startsAt":%q}`, workout, starts))
	if status != http.StatusCreated {
		t.Fatalf("schedule: %d %v", status, body)
	}
	planID := fmt.Sprint(body["id"])
	if status, _ := h.call(t, "bob", http.MethodPut, "/api/rooms/"+slug+"/schedule/"+planID+"/rsvp", `{"going":false}`); status != http.StatusNoContent {
		t.Fatalf("decline: %d", status)
	}
	if status, _ := h.call(t, "carol", http.MethodPut, "/api/rooms/"+slug+"/schedule/"+planID+"/rsvp", `{"going":true}`); status != http.StatusNoContent {
		t.Fatalf("rsvp: %d", status)
	}

	// A move to the time it already has is not a move, so the answer stands.
	if status, _ := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug+"/schedule/"+planID,
		fmt.Sprintf(`{"startsAt":%q}`, starts)); status != http.StatusNoContent {
		t.Fatalf("no-op move: %d", status)
	}
	if answer := h.plan(t, "bob", slug)["yourAnswer"]; answer != "out" {
		t.Fatalf("a move to the same time cleared a decline: %v", answer)
	}

	// A real move does clear it — and leaves the riders who said yes alone.
	if status, _ := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug+"/schedule/"+planID,
		fmt.Sprintf(`{"startsAt":%q}`, time.Now().Add(4*time.Hour).UTC().Format(time.RFC3339))); status != http.StatusNoContent {
		t.Fatalf("move: %d", status)
	}
	if answer := h.plan(t, "bob", slug)["yourAnswer"]; answer != nil {
		t.Errorf("a session nobody turned down still counts a decline: %v", answer)
	}
	plan := h.plan(t, "carol", slug)
	if plan["yourAnswer"] != "in" || count(t, plan, "out") != 0 || count(t, plan, "unanswered") != 2 {
		t.Errorf("after the move: %v, want carol in, nobody out, two unanswered", plan)
	}
}
