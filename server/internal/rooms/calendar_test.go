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
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/join",
		fmt.Sprintf(`{"code":%q}`, code)); status != http.StatusOK {
		t.Fatalf("bob join: %d", status)
	}

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
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/join",
		fmt.Sprintf(`{"code":%q}`, code)); status != http.StatusOK {
		t.Fatalf("bob join: %d", status)
	}

	workout := `{\"name\":\"Openers, v2\",\"steps\":[{\"type\":\"steady\",\"seconds\":600,\"target\":0.75}]}`
	starts := time.Now().UTC().Add(48 * time.Hour).Truncate(time.Second)
	plan := fmt.Sprintf(`{"workoutName":"Openers, v2","workoutJson":"%s","startsAt":%q}`,
		workout, starts.Format(time.RFC3339))
	if status, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule", plan); status != http.StatusCreated {
		t.Fatalf("schedule: %d %v", status, body)
	}

	// A member sees the session with its room attached but no control; the
	// coach who planned it sees the same row as actionable.
	status, body := h.call(t, "bob", http.MethodGet, "/api/schedule", "")
	sessions, _ := body["sessions"].([]any)
	if status != http.StatusOK || len(sessions) != 1 {
		t.Fatalf("bob schedule: %d %v", status, body)
	}
	row, _ := sessions[0].(map[string]any)
	if row["roomSlug"] != slug || row["roomName"] != "Feed Riders" || row["canControl"] != false {
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
	if hers, _ := mine[0].(map[string]any); hers["canControl"] != true {
		t.Fatalf("alice row not controllable: %v", hers)
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
