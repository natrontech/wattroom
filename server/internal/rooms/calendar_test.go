package rooms

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
	workout := `{\"name\":\"Openers, v2\",\"steps\":[{\"type\":\"steady\",\"seconds\":600,\"target\":0.75}]}`
	for name, where := range map[string]string{"Openers, v2": store.UUIDString(channel), "Secret": store.UUIDString(coaches)} {
		plan := fmt.Sprintf(`{"workoutName":%q,"workoutJson":"%s","startsAt":%q,"channelId":%q}`,
			name, workout, starts.Format(time.RFC3339), where)
		if status, body := h.call(t, "alice", http.MethodPost, schedulePath(crew), plan); status != http.StatusCreated {
			t.Fatalf("plan %s: %d %v", name, status, body)
		}
	}
	crewPath := "/api/crews/" + store.UUIDString(crew.ID)

	// Members see the token on the crew; outsiders see no crew at all.
	_, body := h.call(t, "bob", http.MethodGet, crewPath, "")
	token, _ := body["icsToken"].(string)
	if len(token) != 32 {
		t.Fatalf("member token: %q", token)
	}
	if status, body := h.call(t, "carol", http.MethodGet, crewPath, ""); status != http.StatusNotFound || body["icsToken"] != nil {
		t.Fatalf("outsider: %d %v", status, body)
	}

	status, ics, header := h.rawGet(t, crewPath+"/calendar/"+token+".ics")
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
	if status, _, _ := h.rawGet(t, crewPath+"/calendar/nope.ics"); status != http.StatusNotFound {
		t.Fatalf("wrong token: %d", status)
	}
	if status, _, _ := h.rawGet(t, "/api/crews/00000000-0000-0000-0000-000000000000/calendar/"+token+".ics"); status != http.StatusNotFound {
		t.Fatalf("another crew's path: %d", status)
	}

	// Resetting is the owner's and the admins', kills the old link, arms the new.
	if status, _ := h.call(t, "bob", http.MethodPost, crewPath+"/calendar/rotate", ""); status != http.StatusForbidden {
		t.Fatalf("member rotate: %d", status)
	}
	status, body = h.call(t, "alice", http.MethodPost, crewPath+"/calendar/rotate", "")
	fresh, _ := body["icsToken"].(string)
	if status != http.StatusOK || len(fresh) != 32 || fresh == token {
		t.Fatalf("rotate: %d %v", status, body)
	}
	if status, _, _ := h.rawGet(t, crewPath+"/calendar/"+token+".ics"); status != http.StatusNotFound {
		t.Fatalf("old token alive: %d", status)
	}
	if status, _, _ := h.rawGet(t, crewPath+"/calendar/"+fresh+".ics"); status != http.StatusOK {
		t.Fatalf("new token dead: %d", status)
	}
}

// The room feed is gone (#2441): a subscribed calendar goes quiet rather than
// reading a schedule the room no longer keeps.
func TestTheRoomFeedIsGone(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Old Feed")
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}
	if status, _, _ := h.rawGet(t, "/api/rooms/"+slug+"/calendar/"+room.IcsToken+".ics"); status != http.StatusNotFound {
		t.Fatalf("the room feed still answers: %d", status)
	}
	if _, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, ""); body["icsToken"] != nil {
		t.Errorf("the room still hands out a feed token: %v", body["icsToken"])
	}
}

// The rider feed (#325) is one token for every crew a rider is in (#2441),
// and it follows the list as it changes.
func TestRiderCalendarFeed(t *testing.T) {
	h := setup(t)
	crew, channel := h.crewWithChannel(t)
	starts := time.Now().UTC().Add(48 * time.Hour).Truncate(time.Second)
	workout := `{\"name\":\"Openers, v2\",\"steps\":[{\"type\":\"steady\",\"seconds\":600,\"target\":0.75}]}`
	plan := fmt.Sprintf(`{"workoutName":"Openers, v2","workoutJson":"%s","startsAt":%q,"channelId":%q}`,
		workout, starts.Format(time.RFC3339), store.UUIDString(channel))
	if status, body := h.call(t, "alice", http.MethodPost, schedulePath(crew), plan); status != http.StatusCreated {
		t.Fatalf("plan: %d %v", status, body)
	}

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
	if status, body := h.call(t, "bob", http.MethodPost, "/api/crews/"+store.UUIDString(crew.ID)+"/leave", ""); status != http.StatusNoContent && status != http.StatusOK {
		t.Fatalf("bob leaves: %d %v", status, body)
	}
	if _, ics, _ := h.rawGet(t, "/api/calendar/"+fresh+".ics"); strings.Contains(ics, "BEGIN:VEVENT") {
		t.Fatalf("a crew left is still in the feed:\n%s", ics)
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

	// The plan is its crew's (#2440): the ban that takes it away is from
	// that crew, the one the room's plan was made in.
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: h.crewOf(t, slug).ID, UserID: h.users.ByToken["bob"].ID, Role: "banned",
	}); err != nil {
		t.Fatalf("crew ban: %v", err)
	}

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

// The crew feed is handed to every member and exists to be forwarded to
// people who are not in the crew — so it names nobody (ADR-0021 amended,
// #1767). The rider's own feed, one token held by one rider, still says who
// planned what.
func TestTheCrewFeedDoesNotNameThePlanner(t *testing.T) {
	h := setup(t)
	crew, channel := h.crewWithChannel(t)
	crewPath := "/api/crews/" + store.UUIDString(crew.ID)
	// A crew named for its founder would put the planner's name in every
	// event on its own; this test is about who planned.
	if status, body := h.call(t, "alice", http.MethodPatch, crewPath, `{"name":"Quiet Feed"}`); status != http.StatusOK {
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
	_, body := h.call(t, "alice", http.MethodGet, crewPath, "")
	token, _ := body["icsToken"].(string)
	status, ics, _ := h.rawGet(t, crewPath+"/calendar/"+token+".ics")
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
