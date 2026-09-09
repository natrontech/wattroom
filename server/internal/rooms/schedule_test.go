package rooms

// Planned sessions and RSVPs — the tests for schedule.go, split out of
// rooms_test.go (consolidation sweep 2026-09-09).

import (
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
		roomID(t, h, slug), h.users.byToken["bob"].ID); err != nil {
		t.Fatalf("coach: %v", err)
	}
	body := `{"workoutName":"Openers","workoutJson":"{\"name\":\"Openers\",\"steps\":[{\"type\":\"steady\",\"seconds\":600,\"target\":0.75}]}","startsAt":"` + time.Now().Add(2*time.Hour).UTC().Format(time.RFC3339) + `"}`
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/schedule", body); status != http.StatusCreated {
		t.Fatalf("a coach plans: %d", status)
	}
	// The ban row alone, with the membership left as the sweep would have
	// left it had the statement failed.
	crew := h.crewOf(t, slug)
	if _, err := h.store.Pool.Exec(t.Context(), "insert into crew_roles (crew_id, user_id, role) values ($1, $2, 'banned') on conflict (crew_id, user_id) do update set role = 'banned'", crew.ID, h.users.byToken["bob"].ID); err != nil {
		t.Fatalf("ban row: %v", err)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/schedule", body); status != http.StatusForbidden {
		t.Fatalf("a crew-banned coach plans: %d, want 403", status)
	}
}
