package crews

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// rawGet fetches without auth and returns the body verbatim — the feed
// speaks iCal, not the JSON the harness decoder expects.
func (h *harness) rawGet(t *testing.T, path string) (int, string, http.Header) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	w := httptest.NewRecorder()
	h.mux.ServeHTTP(w, req)
	return w.Code, w.Body.String(), w.Result().Header
}

// The crew's feed (#2441, ADR-0021 as amended by ADR-0058): every member
// holds its token, it needs no session, it speaks iCal, and only the crew's
// owner or an admin resets it. A plan in a private channel is not in it —
// the link is for sharing, and that channel's plans are its people's.
func TestCrewCalendarFeed(t *testing.T) {
	h := setup(t)
	crew, channel := h.crewWithChannel(t)
	coaches := h.channel(t, crew, "voice", "Coaches", true)
	starts := time.Now().UTC().Add(48 * time.Hour).Truncate(time.Second)
	for name, where := range map[string]string{"Openers, v2": store.UUIDString(channel), "Secret": store.UUIDString(coaches)} {
		h.planSession(t, "alice", crew, name, starts, where)
	}

	// Members see the token on the crew; outsiders see no crew at all.
	_, body := h.call(t, "bob", http.MethodGet, crewPath(crew), "")
	token, _ := body["icsToken"].(string)
	if len(token) != 32 {
		t.Fatalf("member token: %q", token)
	}
	if status, body := h.call(t, "carol", http.MethodGet, crewPath(crew), ""); status != http.StatusNotFound || body["icsToken"] != nil {
		t.Fatalf("outsider: %d %v", status, body)
	}

	status, ics, header := h.rawGet(t, crewPath(crew, "/calendar/", token, ".ics"))
	if status != http.StatusOK {
		t.Fatalf("feed: %d %s", status, ics)
	}
	if ct := header.Get("Content-Type"); !strings.HasPrefix(ct, "text/calendar") {
		t.Fatalf("content type: %q", ct)
	}
	if cc := header.Get("Cache-Control"); cc != "private, no-store" {
		t.Fatalf("a bearer feed must not be cacheable (#1688): Cache-Control %q", cc)
	}
	for _, want := range []string{
		"BEGIN:VCALENDAR", "BEGIN:VEVENT",
		"SUMMARY:Openers\\, v2", // TEXT escaping
		"DTSTART:" + starts.Format("20060102T150405Z"),
		"DTEND:" + starts.Add(10*time.Minute).Format("20060102T150405Z"),
		"LOCATION:" + crew.Name + " · Pain Cave",
		"/crew/" + store.UUIDString(crew.ID) + "/v/" + store.UUIDString(channel),
	} {
		if !strings.Contains(ics, want) {
			t.Fatalf("feed missing %q in:\n%s", want, ics)
		}
	}
	if !strings.Contains(ics, "\r\n") {
		t.Fatal("feed lines are not CRLF")
	}
	if strings.Contains(ics, "Secret") || strings.Contains(ics, "Coaches") {
		t.Fatalf("a private channel's plan is in the crew's shareable feed:\n%s", ics)
	}

	// A wrong token, and the right token on the wrong crew, 404 alike.
	if status, _, _ := h.rawGet(t, crewPath(crew, "/calendar/nope.ics")); status != http.StatusNotFound {
		t.Fatalf("wrong token: %d", status)
	}
	if status, _, _ := h.rawGet(t, "/api/crews/00000000-0000-0000-0000-000000000000/calendar/"+token+".ics"); status != http.StatusNotFound {
		t.Fatalf("another crew's path: %d", status)
	}

	// Resetting is the owner's and the admins', kills the old link, arms the new.
	if status, _ := h.call(t, "bob", http.MethodPost, crewPath(crew, "/calendar/rotate"), ""); status != http.StatusForbidden {
		t.Fatalf("member rotate: %d", status)
	}
	status, body = h.call(t, "alice", http.MethodPost, crewPath(crew, "/calendar/rotate"), "")
	fresh, _ := body["icsToken"].(string)
	if status != http.StatusOK || len(fresh) != 32 || fresh == token {
		t.Fatalf("rotate: %d %v", status, body)
	}
	if status, _, _ := h.rawGet(t, crewPath(crew, "/calendar/", token, ".ics")); status != http.StatusNotFound {
		t.Fatalf("old token alive: %d", status)
	}
	if status, _, _ := h.rawGet(t, crewPath(crew, "/calendar/", fresh, ".ics")); status != http.StatusOK {
		t.Fatalf("new token dead: %d", status)
	}
}

// The rider feed (#325) is one token for every crew a rider is in (#2441),
// and it follows the list as it changes.
func TestRiderCalendarFeed(t *testing.T) {
	h := setup(t)
	crew, channel := h.crewWithChannel(t)
	starts := time.Now().UTC().Add(48 * time.Hour).Truncate(time.Second)
	h.planSession(t, "alice", crew, "Openers, v2", starts, store.UUIDString(channel))

	// A member sees the session with its crew, channel and length — the row
	// Home draws (#1693).
	status, body := h.call(t, "bob", http.MethodGet, "/api/schedule", "")
	sessions, _ := body["sessions"].([]any)
	if status != http.StatusOK || len(sessions) != 1 {
		t.Fatalf("bob schedule: %d %v", status, body)
	}
	row, _ := sessions[0].(map[string]any)
	if row["crewName"] != crew.Name || row["channelName"] != "Pain Cave" || row["minutes"] != float64(10) {
		t.Fatalf("bob row: %v", row)
	}
	token, _ := body["icsToken"].(string)
	if len(token) != 32 {
		t.Fatalf("bob token: %q", token)
	}
	// Someone in no crew of alice's gets an empty list, not everyone's plans.
	_, body = h.call(t, "carol", http.MethodGet, "/api/schedule", "")
	if theirs, _ := body["sessions"].([]any); len(theirs) != 0 {
		t.Fatalf("carol sees plans: %v", theirs)
	}

	status, ics, header := h.rawGet(t, "/api/calendar/"+token+".ics")
	if status != http.StatusOK {
		t.Fatalf("feed: %d %s", status, ics)
	}
	if cc := header.Get("Cache-Control"); cc != "private, no-store" {
		t.Fatalf("a bearer feed must not be cacheable (#1688): Cache-Control %q", cc)
	}
	for _, want := range []string{
		"X-WR-CALNAME:WattRoom sessions",
		"SUMMARY:Openers\\, v2",
		"LOCATION:" + crew.Name + " · Pain Cave",
		"DTSTART:" + starts.Format("20060102T150405Z"),
		"DTEND:" + starts.Add(10*time.Minute).Format("20060102T150405Z"),
	} {
		if !strings.Contains(ics, want) {
			t.Fatalf("feed missing %q in:\n%s", want, ics)
		}
	}

	// A wrong token 404s, and rotating kills the old link.
	if status, _, _ := h.rawGet(t, "/api/calendar/nope.ics"); status != http.StatusNotFound {
		t.Fatalf("wrong token: %d", status)
	}
	status, body = h.call(t, "bob", http.MethodPost, "/api/calendar/rotate", "")
	fresh, _ := body["icsToken"].(string)
	if status != http.StatusOK || len(fresh) != 32 || fresh == token {
		t.Fatalf("rotate: %d %v", status, body)
	}
	if status, _, _ := h.rawGet(t, "/api/calendar/"+token+".ics"); status != http.StatusNotFound {
		t.Fatalf("old token alive: %d", status)
	}

	// Leaving the crew takes its sessions out of the feed — membership is the
	// subscription, checked on read, not at subscribe time.
	if status, body := h.call(t, "bob", http.MethodPost, crewPath(crew, "/leave"), ""); status != http.StatusNoContent {
		t.Fatalf("bob leaves: %d %v", status, body)
	}
	if _, ics, _ := h.rawGet(t, "/api/calendar/"+fresh+".ics"); strings.Contains(ics, "BEGIN:VEVENT") {
		t.Fatalf("a crew left is still in the feed:\n%s", ics)
	}
}

// A crew ban is a role row and nothing else (#1904): a rider's schedule
// reads the role, or a banned rider would go on being shown the crew's plans.
func TestACrewBanTakesItsPlansOffTheRidersSchedule(t *testing.T) {
	h := setup(t)
	crew, _ := h.crewWithChannel(t)
	h.planSession(t, "alice", crew, "Openers", time.Now().UTC().Add(48*time.Hour), "")
	_, body := h.call(t, "bob", http.MethodGet, "/api/schedule", "")
	if before, _ := body["sessions"].([]any); len(before) != 1 {
		t.Fatalf("bob before the ban: %v — test proves nothing", body["sessions"])
	}

	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: crew.ID, UserID: h.users.ByToken["bob"].ID, Role: "banned",
	}); err != nil {
		t.Fatalf("crew ban: %v", err)
	}

	status, body := h.call(t, "bob", http.MethodGet, "/api/schedule", "")
	after, _ := body["sessions"].([]any)
	if status != http.StatusOK || len(after) != 0 {
		t.Fatalf("a crew-banned rider still sees the crew's plans: %d %v", status, body["sessions"])
	}
}

// Home's "What's next" is one row per planned session, across crews (#1693,
// ADR-0020): a crew with three plans this week shows three, as the rider's
// calendar does. And the row is deliberately not the crew schedule's: saying
// you are in stays on the crew's schedule, so `going` is absent here rather
// than present and empty, and the workout JSON no cross-crew list renders
// does not ride along.
func TestHomeListsEveryPlanAndNoRsvp(t *testing.T) {
	h := setup(t)
	crew, _ := h.crewWithChannel(t)

	ids := make([]string, 0, 3)
	for _, hours := range []int{72, 24, 48} { // planned out of order, listed in order
		starts := time.Now().UTC().Add(time.Duration(hours) * time.Hour).Truncate(time.Second)
		ids = append(ids, h.planSession(t, "alice", crew, "Openers", starts, ""))
	}

	// Bob is in for one of them, said on the crew's schedule where RSVP lives.
	if status, body := h.call(t, "bob", http.MethodPut, schedulePath(crew, "/", ids[0], "/rsvp"), ""); status != http.StatusNoContent {
		t.Fatalf("rsvp: %d %v", status, body)
	}

	_, body := h.call(t, "bob", http.MethodGet, "/api/schedule", "")
	sessions, _ := body["sessions"].([]any)
	if len(sessions) != 3 {
		t.Fatalf("one crew with three plans gave %d rows on Home: %v", len(sessions), body["sessions"])
	}
	last := ""
	for i, entry := range sessions {
		row, _ := entry.(map[string]any)
		startsAt, _ := row["startsAt"].(string)
		if startsAt <= last {
			t.Fatalf("row %d out of order: %q after %q", i, startsAt, last)
		}
		last = startsAt
		for _, gone := range []string{"going", "workoutJson", "canControl"} {
			if _, ok := row[gone]; ok {
				t.Errorf("row %d carries %q — RSVP and the workout stay on the crew's schedule (#1693): %v", i, gone, row)
			}
		}
	}

	// And the crew's own schedule still carries the RSVP, which is the half
	// the decision kept: the field is dead on the cross-crew list, not
	// everywhere.
	var rsvps int
	for _, entry := range h.crewSchedule(t, "bob", crew) {
		going, _ := entry["going"].([]any)
		rsvps += len(going)
	}
	if rsvps != 1 {
		t.Fatalf("the crew's schedule lost the RSVP it owns: %d", rsvps)
	}
}

// The crew feed is handed to every member and exists to be forwarded to
// people who are not in the crew — so it names nobody (ADR-0021 amended,
// #1767). The rider's own feed, one token held by one rider, still says who
// planned what.
func TestTheCrewFeedDoesNotNameThePlanner(t *testing.T) {
	h := setup(t)
	crew, channel := h.crewWithChannel(t)
	// A crew named for its founder would put the planner's name in every
	// event on its own; this test is about who planned.
	if status, body := h.call(t, "alice", http.MethodPatch, crewPath(crew), `{"name":"Quiet Feed"}`); status != http.StatusOK {
		t.Fatalf("rename: %d %v", status, body)
	}
	starts := time.Now().UTC().Add(48 * time.Hour).Truncate(time.Second)
	if status, body := h.call(t, "bob", http.MethodPost, schedulePath(crew), crewPlanBody(starts, store.UUIDString(channel))); status != http.StatusCreated {
		t.Fatalf("plan: %d %v", status, body)
	}
	var planner string
	for _, entry := range h.crewSchedule(t, "alice", crew) {
		planner, _ = entry["createdBy"].(string)
	}
	if planner == "" {
		t.Fatal("no planner on the plan — test proves nothing")
	}
	_, body := h.call(t, "alice", http.MethodGet, crewPath(crew), "")
	token, _ := body["icsToken"].(string)
	status, ics, _ := h.rawGet(t, crewPath(crew, "/calendar/", token, ".ics"))
	if status != http.StatusOK {
		t.Fatalf("crew feed: %d %s", status, ics)
	}
	if strings.Contains(ics, planner) {
		t.Fatalf("the crew feed names its planner %q — a link every member can forward:\n%s", planner, ics)
	}
	if !strings.Contains(ics, "DESCRIPTION:In Quiet Feed · Pain Cave.") {
		t.Fatalf("crew feed description:\n%s", ics)
	}

	_, mine := h.call(t, "alice", http.MethodGet, "/api/schedule", "")
	riderToken, _ := mine["icsToken"].(string)
	status, riderICS, _ := h.rawGet(t, "/api/calendar/"+riderToken+".ics")
	if status != http.StatusOK {
		t.Fatalf("rider feed: %d %s", status, riderICS)
	}
	if !strings.Contains(riderICS, "DESCRIPTION:Planned by "+planner+" in Quiet Feed · Pain Cave.") {
		t.Fatalf("the rider's own feed lost its planner:\n%s", riderICS)
	}
}

// Two sessions may share a minute (docs/SPEC.md) and one of them is the
// crew's next. Ordering by starts_at alone would leave that to whichever row
// the read happened to return first: a plan MOVED onto another's time is
// rewritten, so it comes back last from the heap and from the index alike,
// and the crew would name the later-planned session as next — differently
// from Home, and differently from itself one read earlier (#1767).
func TestOverlappingPlansLeadInTheOrderTheyWerePlanned(t *testing.T) {
	h := setup(t)
	crew, _ := h.crewWithChannel(t)
	at := time.Now().UTC().Add(48 * time.Hour).Truncate(time.Second)

	// Planned first, for later; then the one it will end up sharing a minute
	// with.
	elder := h.planSession(t, "alice", crew, "Elder", at.Add(time.Hour), "")
	h.planSession(t, "alice", crew, "Younger", at, "")
	if status, body := h.call(t, "alice", http.MethodPatch, schedulePath(crew, "/", elder),
		fmt.Sprintf(`{"startsAt":%q}`, at.Format(time.RFC3339))); status != http.StatusNoContent {
		t.Fatalf("move: %d %v", status, body)
	}

	// Read the unchanged schedule several times: same answer every time, and
	// the answer is the plan that was made first.
	for i := range 5 {
		_, body := h.call(t, "alice", http.MethodGet, schedulePath(crew), "")
		sessions, _ := body["sessions"].([]any)
		if len(sessions) != 2 {
			t.Fatalf("read %d: overlapping plans were refused or lost: %v", i, body["sessions"])
		}
		next, _ := sessions[0].(map[string]any)
		if next["workoutName"] != "Elder" {
			t.Fatalf("read %d: %q leads two tied plans; the one planned first does", i, next["workoutName"])
		}
	}

	// Home answers the same question with its own query, and the two may not
	// disagree about which session is the crew's next.
	_, body := h.call(t, "alice", http.MethodGet, "/api/schedule", "")
	sessions, _ := body["sessions"].([]any)
	var listed bool
	for _, entry := range sessions {
		row, _ := entry.(map[string]any)
		if row["crewId"] != store.UUIDString(crew.ID) {
			continue
		}
		listed = true
		if row["workoutName"] != "Elder" {
			t.Fatalf("Home's next session is %v, the crew's is Elder", row["workoutName"])
		}
		break
	}
	// Without this the loop asserts nothing the day Home stops listing it.
	if !listed {
		t.Fatalf("Home never listed the crew's plans: %v", body["sessions"])
	}
}
