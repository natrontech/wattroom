package crews

// Answering a crew's plan — in, out, or not yet (#450, #1011) — and who the
// crew stops counting.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// A planned session with an RSVP is what #450 calls an event: any member can
// say they are in, the schedule shows who, and saying it twice says it once.
func TestSessionRsvp(t *testing.T) {
	h := setup(t)
	crew, _ := h.crewWithChannel(t)
	plan := h.planSession(t, "alice", crew, "Openers", time.Now().Add(2*time.Hour), "")
	rsvp := schedulePath(crew, "/", plan, "/rsvp")

	// Signed out, a stranger, and an unknown plan all bounce — the stranger
	// with the 404 a crew they are not in answers everything with.
	if status, _ := h.call(t, "", http.MethodPut, rsvp, ""); status != http.StatusUnauthorized {
		t.Fatalf("signed out rsvp: %d", status)
	}
	if status, _ := h.call(t, "carol", http.MethodPut, rsvp, ""); status != http.StatusNotFound {
		t.Fatalf("stranger rsvp: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPut,
		schedulePath(crew, "/00000000-0000-0000-0000-000000000000/rsvp"), ""); status != http.StatusNotFound {
		t.Fatalf("unknown plan rsvp: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPut, schedulePath(crew, "/not-a-uuid/rsvp"), ""); status != http.StatusNotFound {
		t.Fatalf("malformed plan rsvp: %d", status)
	}

	// Bob is in, twice — and the schedule says so once.
	for range 2 {
		if status, _ := h.call(t, "bob", http.MethodPut, rsvp, ""); status != http.StatusNoContent {
			t.Fatalf("rsvp: %d", status)
		}
	}
	going, _ := h.planSeenBy(t, "alice", crew, plan)["going"].([]any)
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
	if going, _ := h.planSeenBy(t, "alice", crew, plan)["going"].([]any); len(going) != 0 {
		t.Fatalf("going after cancel: %v", going)
	}
}

// Someone who has left the crew since they said yes is not coming (#1675):
// the answer they gave stays in the table, and must not stay on the card.
func TestAMemberWhoLeftIsNotComing(t *testing.T) {
	h := setup(t)
	crew, _ := h.crewWithChannel(t)
	plan := h.planSession(t, "alice", crew, "Openers", time.Now().Add(2*time.Hour), "")
	if status, _ := h.call(t, "bob", http.MethodPut, schedulePath(crew, "/", plan, "/rsvp"), ""); status != http.StatusNoContent {
		t.Fatalf("rsvp: %d", status)
	}
	if going, _ := h.planSeenBy(t, "alice", crew, plan)["going"].([]any); len(going) != 1 {
		t.Fatalf("going after rsvp: %v — test proves nothing", going)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, crewPath(crew, "/leave"), ""); status != http.StatusNoContent {
		t.Fatalf("leave: %d", status)
	}
	if going, _ := h.planSeenBy(t, "alice", crew, plan)["going"].([]any); len(going) != 0 {
		t.Errorf("a member who left is still coming: %v", going)
	}
}

// The ban row alone shuts the planning door (#1763): the crew's role is the
// last word on who may plan, whether or not anything else a ban does has run.
func TestACrewBannedMemberCannotPlan(t *testing.T) {
	h := setup(t)
	crew, _ := h.crewWithChannel(t)
	body := crewPlanBody(time.Now().Add(2*time.Hour), "")
	if status, _ := h.call(t, "bob", http.MethodPost, schedulePath(crew), body); status != http.StatusCreated {
		t.Fatalf("a member plans: %d", status)
	}
	// Straight to the row: the ban is the fixture, and nothing the API's ban
	// does beside writing it may be what refuses the plan.
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: crew.ID, UserID: h.users.ByToken["bob"].ID, Role: "banned",
	}); err != nil {
		t.Fatalf("ban row: %v", err)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, schedulePath(crew), body); status != http.StatusNotFound {
		t.Fatalf("a crew-banned member plans: %d, want the 404 a crew answers a banned rider with", status)
	}
}

// The third state (#1011): "said no" is a row that says no, and only the
// absence of a row means nobody has answered. The schedule reads a decline as
// a COUNT — who is in is named, who is out is a number, because the number is
// what tells a planner whether to hold the session and the names would only
// add the pressure.
func TestSessionDecline(t *testing.T) {
	h := setup(t)
	crew, _ := h.crewWithChannel(t)
	h.join(t, "carol", crew)
	plan := h.planSession(t, "alice", crew, "Openers", time.Now().Add(2*time.Hour), "")
	rsvp := schedulePath(crew, "/", plan, "/rsvp")

	// Three in the crew, nobody has answered — which is three unanswered and
	// no "out" field at all.
	entry := h.planSeenBy(t, "alice", crew, plan)
	if got := count(t, entry, "unanswered"); got != 3 {
		t.Fatalf("unanswered before anyone answers: %d, want 3 — %v", got, entry)
	}

	// Bob says no. He is not in the list, he is one of the "out", and the
	// crew is down to two who have not answered.
	if status, body := h.call(t, "bob", http.MethodPut, rsvp, `{"going":false}`); status != http.StatusNoContent {
		t.Fatalf("decline: %d %v", status, body)
	}
	entry = h.planSeenBy(t, "alice", crew, plan)
	if going, _ := entry["going"].([]any); len(going) != 0 {
		t.Fatalf("a decline joined the who-is-in line: %v", going)
	}
	if out, un := count(t, entry, "out"), count(t, entry, "unanswered"); out != 1 || un != 2 {
		t.Fatalf("after one decline: %d out, %d unanswered, want 1 and 2 — %v", out, un, entry)
	}
	// The decision this implements, asserted rather than described: the plan
	// carries the number and NOT the name. Marshalled whole, because a
	// decline leaking through some other field is the failure to catch.
	seen, err := json.Marshal(entry)
	if err != nil {
		t.Fatalf("marshal the plan: %v", err)
	}
	for _, trace := range []string{h.userID(t, "bob"), h.displayName(t, "bob")} {
		if bytes.Contains(seen, []byte(trace)) {
			t.Errorf("the schedule named who declined (%s): %s", trace, seen)
		}
	}
	// Bob's own copy tells him where he stands — nobody else's does.
	if mine := h.planSeenBy(t, "bob", crew, plan)["yourAnswer"]; mine != "out" {
		t.Errorf("a decliner cannot see their own answer: %v", mine)
	}
	if theirs := h.planSeenBy(t, "carol", crew, plan)["yourAnswer"]; theirs != nil {
		t.Errorf("carol was handed an answer she never gave: %v", theirs)
	}

	// Changing your mind is free and takes no take-back first: one PUT.
	if status, _ := h.call(t, "bob", http.MethodPut, rsvp, `{"going":true}`); status != http.StatusNoContent {
		t.Fatalf("change of mind: %d", status)
	}
	entry = h.planSeenBy(t, "bob", crew, plan)
	if going, _ := entry["going"].([]any); len(going) != 1 || entry["yourAnswer"] != "in" {
		t.Fatalf("a rider who changed their mind is not in: %v", entry)
	}
	if out, un := count(t, entry, "out"), count(t, entry, "unanswered"); out != 0 || un != 2 {
		t.Fatalf("after the change of mind: %d out, %d unanswered, want 0 and 2 — %v", out, un, entry)
	}

	// A PUT with no body is the spelling the app used before declines
	// existed, and it still means "in" — a tab loaded before the deploy.
	if status, _ := h.call(t, "carol", http.MethodPut, rsvp, ""); status != http.StatusNoContent {
		t.Fatalf("body-less rsvp: %d", status)
	}
	if answer := h.planSeenBy(t, "carol", crew, plan)["yourAnswer"]; answer != "in" {
		t.Fatalf("a body-less PUT stopped meaning in: %v", answer)
	}

	// Taking the answer back is the third state again, from either side.
	if status, _ := h.call(t, "bob", http.MethodDelete, rsvp, ""); status != http.StatusNoContent {
		t.Fatalf("take it back: %d", status)
	}
	entry = h.planSeenBy(t, "bob", crew, plan)
	if entry["yourAnswer"] != nil || count(t, entry, "unanswered") != 2 {
		t.Fatalf("taking an answer back did not leave it unanswered: %v", entry)
	}

	// A body that is not an answer is a 400 and changes nothing (errors.md).
	for _, bad := range []string{`{"going":"nope"}`, `{"coming":false}`, `not json`} {
		if status, body := h.call(t, "bob", http.MethodPut, rsvp, bad); status != http.StatusBadRequest || body["error"] != "invalid_request" {
			t.Errorf("%s: %d %v, want 400 invalid_request", bad, status, body)
		}
	}
	if entry := h.planSeenBy(t, "bob", crew, plan); entry["yourAnswer"] != nil {
		t.Errorf("a refused body wrote an answer anyway: %v", entry)
	}
}

// A moved session asks the people who said no again (#1011), on the same
// condition as the reminder's own re-arm: a move to the time it already had
// is not a move.
func TestAMoveAsksTheDeclinersAgain(t *testing.T) {
	h := setup(t)
	crew, channel := h.crewWithChannel(t)
	h.join(t, "carol", crew)
	starts := time.Now().Add(2 * time.Hour).UTC().Truncate(time.Second)
	plan := h.planSession(t, "alice", crew, "Openers", starts, store.UUIDString(channel))
	rsvp := schedulePath(crew, "/", plan, "/rsvp")
	if status, _ := h.call(t, "bob", http.MethodPut, rsvp, `{"going":false}`); status != http.StatusNoContent {
		t.Fatalf("decline: %d", status)
	}
	if status, _ := h.call(t, "carol", http.MethodPut, rsvp, `{"going":true}`); status != http.StatusNoContent {
		t.Fatalf("rsvp: %d", status)
	}

	// A move to the time it already has is not a move, so the answer stands.
	if status, _ := h.call(t, "alice", http.MethodPatch, schedulePath(crew, "/", plan),
		fmt.Sprintf(`{"startsAt":%q}`, starts.Format(time.RFC3339))); status != http.StatusNoContent {
		t.Fatalf("no-op move: %d", status)
	}
	if answer := h.planSeenBy(t, "bob", crew, plan)["yourAnswer"]; answer != "out" {
		t.Fatalf("a move to the same time cleared a decline: %v", answer)
	}

	// A real move does clear it — and leaves the riders who said yes alone.
	if status, _ := h.call(t, "alice", http.MethodPatch, schedulePath(crew, "/", plan),
		fmt.Sprintf(`{"startsAt":%q}`, time.Now().Add(4*time.Hour).UTC().Format(time.RFC3339))); status != http.StatusNoContent {
		t.Fatalf("move: %d", status)
	}
	if answer := h.planSeenBy(t, "bob", crew, plan)["yourAnswer"]; answer != nil {
		t.Errorf("a session nobody turned down still counts a decline: %v", answer)
	}
	entry := h.planSeenBy(t, "carol", crew, plan)
	if entry["yourAnswer"] != "in" || count(t, entry, "out") != 0 || count(t, entry, "unanswered") != 2 {
		t.Errorf("after the move: %v, want carol in, nobody out, two unanswered", entry)
	}
}
