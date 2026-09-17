package rooms

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
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

func TestCalendarFeed(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Feed Riders")
	h.enter(t, "bob", code, slug)

	workout := `{\"name\":\"Openers, v2\",\"steps\":[{\"type\":\"steady\",\"seconds\":600,\"target\":0.75}]}`
	starts := time.Now().UTC().Add(48 * time.Hour).Truncate(time.Second)
	plan := fmt.Sprintf(`{"workoutName":"Openers, v2","workoutJson":"%s","startsAt":%q}`,
		workout, starts.Format(time.RFC3339))
	if status, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule", plan); status != http.StatusCreated {
		t.Fatalf("schedule: %d %v", status, body)
	}

	// Members see the token on the room; outsiders don't.
	status, body := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	token, _ := body["icsToken"].(string)
	if status != http.StatusOK || len(token) != 32 {
		t.Fatalf("member token: %d %q", status, token)
	}
	if _, body := h.call(t, "carol", http.MethodGet, "/api/rooms/"+slug, ""); body["icsToken"] != nil {
		t.Fatalf("outsider sees token: %v", body["icsToken"])
	}

	// The feed needs no auth — just the token — and speaks iCal.
	status, ics, header := h.rawGet(t, "/api/rooms/"+slug+"/calendar/"+token+".ics")
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
	} {
		if !strings.Contains(ics, want) {
			t.Fatalf("feed missing %q in:\n%s", want, ics)
		}
	}
	if !strings.Contains(ics, "\r\n") {
		t.Fatal("feed lines are not CRLF")
	}

	// A wrong token 404s without confirming anything.
	if status, _, _ := h.rawGet(t, "/api/rooms/"+slug+"/calendar/nope.ics"); status != http.StatusNotFound {
		t.Fatalf("wrong token: %d", status)
	}

	// Rotation is owner-only, kills the old link, arms the new one.
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/calendar/rotate", ""); status != http.StatusForbidden {
		t.Fatalf("member rotate: %d", status)
	}
	status, body = h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/calendar/rotate", "")
	fresh, _ := body["icsToken"].(string)
	if status != http.StatusOK || len(fresh) != 32 || fresh == token {
		t.Fatalf("rotate: %d %v", status, body)
	}
	if status, _, _ := h.rawGet(t, "/api/rooms/"+slug+"/calendar/"+token+".ics"); status != http.StatusNotFound {
		t.Fatalf("old token alive: %d", status)
	}
	if status, _, _ := h.rawGet(t, "/api/rooms/"+slug+"/calendar/"+fresh+".ics"); status != http.StatusOK {
		t.Fatalf("new token dead: %d", status)
	}
}

// The rider feed (#325) is the room feed's answer to "I ride in four rooms":
// one token, every membership, and it follows the list as it changes.
func TestRiderCalendarFeed(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Feed Riders")
	h.enter(t, "bob", code, slug)

	workout := `{\"name\":\"Openers, v2\",\"steps\":[{\"type\":\"steady\",\"seconds\":600,\"target\":0.75}]}`
	starts := time.Now().UTC().Add(48 * time.Hour).Truncate(time.Second)
	plan := fmt.Sprintf(`{"workoutName":"Openers, v2","workoutJson":"%s","startsAt":%q}`,
		workout, starts.Format(time.RFC3339))
	if status, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule", plan); status != http.StatusCreated {
		t.Fatalf("schedule: %d %v", status, body)
	}

	// A member sees the session with its room and its length attached — the
	// row Home draws (#1693).
	status, body := h.call(t, "bob", http.MethodGet, "/api/schedule", "")
	sessions, _ := body["sessions"].([]any)
	if status != http.StatusOK || len(sessions) != 1 {
		t.Fatalf("bob schedule: %d %v", status, body)
	}
	row, _ := sessions[0].(map[string]any)
	if row["roomSlug"] != slug || row["roomName"] != "Feed Riders" || row["minutes"] != float64(10) {
		t.Fatalf("bob row: %v", row)
	}
	token, _ := body["icsToken"].(string)
	if len(token) != 32 {
		t.Fatalf("bob token: %q", token)
	}
	_, body = h.call(t, "alice", http.MethodGet, "/api/schedule", "")
	mine, _ := body["sessions"].([]any)
	if len(mine) != 1 {
		t.Fatalf("alice schedule: %v", body["sessions"])
	}

	// Someone with no membership gets an empty list, not everyone's plans.
	_, body = h.call(t, "carol", http.MethodGet, "/api/schedule", "")
	if theirs, _ := body["sessions"].([]any); len(theirs) != 0 {
		t.Fatalf("carol sees plans: %v", theirs)
	}

	// The feed needs no auth — just the token — and names the room per event,
	// which is the whole point of a cross-room calendar.
	status, ics, header := h.rawGet(t, "/api/calendar/"+token+".ics")
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
		"X-WR-CALNAME:WattRoom sessions",
		"SUMMARY:Openers\\, v2",
		"LOCATION:Feed Riders",
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
	if status, _, _ := h.rawGet(t, "/api/calendar/"+fresh+".ics"); status != http.StatusOK {
		t.Fatalf("new token dead: %d", status)
	}

	// Leaving the room takes its sessions out of the feed — membership is the
	// subscription, so it is checked on read, not at subscribe time.
	if status, _ := h.call(t, "bob", http.MethodDelete,
		"/api/rooms/"+slug+"/members/"+h.userID(t, "bob"), ""); status != http.StatusNoContent {
		t.Fatalf("bob leave: %d", status)
	}
	if _, ics, _ := h.rawGet(t, "/api/calendar/"+fresh+".ics"); strings.Contains(ics, "BEGIN:VEVENT") {
		t.Fatalf("left room still in feed:\n%s", ics)
	}
}

// A crew ban lives in visible_rooms alone; the calendar used to read the
// membership row and keep mailing the banned rider the crew's plans (#1904).
func TestACrewBanTakesTheRoomOutOfTheCalendar(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Feed Banned")
	h.enter(t, "bob", code, slug)
	workout := `{\"name\":\"Openers\",\"steps\":[{\"type\":\"steady\",\"seconds\":600,\"target\":0.75}]}`
	starts := time.Now().UTC().Add(48 * time.Hour).Truncate(time.Second)
	plan := fmt.Sprintf(`{"workoutName":"Openers","workoutJson":"%s","startsAt":%q}`, workout, starts.Format(time.RFC3339))
	if status, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule", plan); status != http.StatusCreated {
		t.Fatalf("schedule: %d %v", status, body)
	}
	_, body := h.call(t, "bob", http.MethodGet, "/api/schedule", "")
	if before, _ := body["sessions"].([]any); len(before) != 1 {
		t.Fatalf("bob before the ban: %v — test proves nothing", body["sessions"])
	}

	h.crewBan(t, slug, "bob")

	status, body := h.call(t, "bob", http.MethodGet, "/api/schedule", "")
	after, _ := body["sessions"].([]any)
	if status != http.StatusOK || len(after) != 0 {
		t.Fatalf("a crew-banned rider still sees the crew's plans: %d %v", status, body["sessions"])
	}
}

// A started plan is marked once and stops offering itself (#1905): the
// room's upcoming list drops it, and a second start is a conflict.
func TestAStartedPlanStopsOfferingItself(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Start Once")
	workout := `{\"name\":\"Openers\",\"steps\":[{\"type\":\"steady\",\"seconds\":600,\"target\":0.75}]}`
	starts := time.Now().UTC().Add(5 * time.Minute).Truncate(time.Second)
	plan := fmt.Sprintf(`{"workoutName":"Openers","workoutJson":"%s","startsAt":%q}`, workout, starts.Format(time.RFC3339))
	status, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule", plan)
	if status != http.StatusCreated {
		t.Fatalf("schedule: %d %v", status, body)
	}
	id, _ := body["id"].(string)
	if id == "" {
		t.Fatalf("no id in %v", body)
	}
	_, room := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	if before, _ := room["upcoming"].([]any); len(before) != 1 {
		t.Fatalf("upcoming before the start: %v — test proves nothing", room["upcoming"])
	}

	if status, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule/"+id+"/started", ""); status != http.StatusNoContent {
		t.Fatalf("started: %d %v", status, body)
	}
	_, room = h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	if after, _ := room["upcoming"].([]any); len(after) != 0 {
		t.Fatalf("a started plan still offers itself: %v", room["upcoming"])
	}
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule/"+id+"/started", ""); status != http.StatusConflict {
		t.Fatalf("a second start: %d, want 409", status)
	}
}

// Home's "What's next" is one row per planned session, across rooms (#1693,
// ADR-0020) — it used to draw one row per room off the rail feed's `next`,
// so a room with three plans this week showed one while the same rider's
// calendar showed all three. And the row is deliberately not the room's:
// saying you are in stays a room surface, so `going` is absent here rather
// than present and empty, and the workout JSON no cross-room list renders
// does not ride along.
func TestHomeListsEveryPlanAndNoRsvp(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Three Plans")
	h.enter(t, "bob", code, slug)

	workout := `{\"name\":\"Openers\",\"steps\":[{\"type\":\"steady\",\"seconds\":600,\"target\":0.75}]}`
	ids := make([]string, 0, 3)
	for _, hours := range []int{72, 24, 48} { // planned out of order, listed in order
		starts := time.Now().UTC().Add(time.Duration(hours) * time.Hour).Truncate(time.Second)
		plan := fmt.Sprintf(`{"workoutName":"Openers","workoutJson":"%s","startsAt":%q}`,
			workout, starts.Format(time.RFC3339))
		status, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule", plan)
		if status != http.StatusCreated {
			t.Fatalf("schedule +%dh: %d %v", hours, status, body)
		}
		id, _ := body["id"].(string)
		ids = append(ids, id)
	}

	// Bob is in for one of them, said in the room where RSVP lives.
	if status, body := h.call(t, "bob", http.MethodPut,
		"/api/rooms/"+slug+"/schedule/"+ids[0]+"/rsvp", ""); status != http.StatusNoContent {
		t.Fatalf("rsvp: %d %v", status, body)
	}

	_, body := h.call(t, "bob", http.MethodGet, "/api/schedule", "")
	sessions, _ := body["sessions"].([]any)
	if len(sessions) != 3 {
		t.Fatalf("one room with three plans gave %d rows on Home: %v", len(sessions), body["sessions"])
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
				t.Errorf("row %d carries %q — RSVP and the workout stay in the room (#1693): %v", i, gone, row)
			}
		}
	}

	// And the room's own route still carries the RSVP, which is the half the
	// decision kept: the field is dead on the cross-room list, not everywhere.
	_, room := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	upcoming, _ := room["upcoming"].([]any)
	var rsvps int
	for _, entry := range upcoming {
		row, _ := entry.(map[string]any)
		going, _ := row["going"].([]any)
		rsvps += len(going)
	}
	if rsvps != 1 {
		t.Fatalf("the room lost the RSVP it owns: %d in %v", rsvps, room["upcoming"])
	}
}

// The room feed is handed to every non-banned member, rotates only for the
// owner, and exists to be forwarded to people who are not in the room — so it
// names nobody (ADR-0021 amended, #1767). The rider's own feed, one token held
// by one rider, still says who planned what.
func TestTheRoomFeedDoesNotNameThePlanner(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Quiet Feed")
	h.enter(t, "bob", code, slug)

	workout := `{\"name\":\"Openers\",\"steps\":[{\"type\":\"steady\",\"seconds\":600,\"target\":0.75}]}`
	starts := time.Now().UTC().Add(48 * time.Hour).Truncate(time.Second)
	plan := fmt.Sprintf(`{"workoutName":"Openers","workoutJson":"%s","startsAt":%q}`, workout, starts.Format(time.RFC3339))
	if status, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule", plan); status != http.StatusCreated {
		t.Fatalf("schedule: %d %v", status, body)
	}

	// Whatever display name the harness gave the planner, the room feed must
	// not carry it — asked of the room read, so the test cannot pass by
	// looking for a name nobody has.
	_, room := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	upcoming, _ := room["upcoming"].([]any)
	if len(upcoming) != 1 {
		t.Fatalf("upcoming: %v — test proves nothing", room["upcoming"])
	}
	first, _ := upcoming[0].(map[string]any)
	planner, _ := first["createdBy"].(string)
	if planner == "" {
		t.Fatalf("no planner on the plan: %v", first)
	}
	token, _ := room["icsToken"].(string)

	status, ics, _ := h.rawGet(t, "/api/rooms/"+slug+"/calendar/"+token+".ics")
	if status != http.StatusOK {
		t.Fatalf("room feed: %d %s", status, ics)
	}
	if strings.Contains(ics, planner) {
		t.Fatalf("the room feed names its planner %q — a link every member can forward:\n%s", planner, ics)
	}
	if !strings.Contains(ics, "DESCRIPTION:In Quiet Feed.") {
		t.Fatalf("room feed description:\n%s", ics)
	}

	// The same session, in the feed addressed to the rider: still named.
	_, mine := h.call(t, "alice", http.MethodGet, "/api/schedule", "")
	riderToken, _ := mine["icsToken"].(string)
	status, riderICS, _ := h.rawGet(t, "/api/calendar/"+riderToken+".ics")
	if status != http.StatusOK {
		t.Fatalf("rider feed: %d %s", status, riderICS)
	}
	if !strings.Contains(riderICS, "DESCRIPTION:Planned by "+planner+" in Quiet Feed.") {
		t.Fatalf("the rider's own feed lost its planner:\n%s", riderICS)
	}
}

// Two sessions may share a minute (docs/SPEC.md) and one of them wears the
// room's "next" label. Ordering by starts_at alone left that on whichever row
// the read happened to return first: a plan that is MOVED onto another's time
// is rewritten, so it comes back last from the heap and from the index alike,
// and the room named the later-planned session as next — differently from the
// rail, and differently from itself one read earlier (#1767).
func TestOverlappingPlansLeadInTheOrderTheyWerePlanned(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Two At Once")

	workout := `{\"name\":\"Openers\",\"steps\":[{\"type\":\"steady\",\"seconds\":600,\"target\":0.75}]}`
	at := time.Now().UTC().Add(48 * time.Hour).Truncate(time.Second)
	plan := func(name string, when time.Time) string {
		status, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule",
			fmt.Sprintf(`{"workoutName":%q,"workoutJson":"%s","startsAt":%q}`, name, workout, when.Format(time.RFC3339)))
		if status != http.StatusCreated {
			t.Fatalf("schedule %s: %d %v", name, status, body)
		}
		id, _ := body["id"].(string)
		return id
	}
	// Planned first, for later; then the one it will end up sharing a minute
	// with.
	elder := plan("Elder", at.Add(time.Hour))
	plan("Younger", at)
	if status, body := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug+"/schedule/"+elder,
		fmt.Sprintf(`{"startsAt":%q}`, at.Format(time.RFC3339))); status != http.StatusNoContent {
		t.Fatalf("move: %d %v", status, body)
	}

	// Read the unchanged room several times: same answer every time, and the
	// answer is the plan that was made first.
	for i := range 5 {
		_, room := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
		upcoming, _ := room["upcoming"].([]any)
		if len(upcoming) != 2 {
			t.Fatalf("read %d: overlapping plans were refused or lost: %v", i, room["upcoming"])
		}
		next, _ := upcoming[0].(map[string]any)
		if next["workoutName"] != "Elder" {
			t.Fatalf("read %d: %q leads two tied plans; the one planned first does", i, next["workoutName"])
		}
	}

	// The rail answers the same question with its own query, and the two may
	// not disagree about which session a room's next one is.
	_, body := h.call(t, "alice", http.MethodGet, "/api/rooms", "")
	rooms, _ := body["rooms"].([]any)
	var railed bool
	for _, entry := range rooms {
		row, _ := entry.(map[string]any)
		if row["slug"] != slug {
			continue
		}
		railed = true
		next, _ := row["nextSession"].(map[string]any)
		if next == nil || next["workoutName"] != "Elder" {
			t.Fatalf("the rail's next session is %v, the room's is Elder", next)
		}
	}
	// Without this the loop asserts nothing the day the room stops listing.
	if !railed {
		t.Fatalf("the rail never listed %s: %v", slug, body["rooms"])
	}
}
