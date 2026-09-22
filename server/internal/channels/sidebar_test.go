package channels

import (
	"net/http"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
)

// The sidebar's one fetch (#2444).

// liveCrew is the harness crew's entry in who's /api/crews/live.
func (h *harness) liveCrew(t *testing.T, who string) map[string]any {
	t.Helper()
	status, body := h.call(t, who, http.MethodGet, "/api/crews/live", "")
	if status != http.StatusOK {
		t.Fatalf("%s reading live: %d %v", who, status, body)
	}
	crews, _ := body["crews"].([]any)
	for _, c := range crews {
		crew, _ := c.(map[string]any)
		if crew["id"] == h.crew {
			return crew
		}
	}
	return nil
}

// channelsOf is a live crew entry's channels by name.
func channelsOf(crew map[string]any) map[string]map[string]any {
	out := map[string]map[string]any{}
	rows, _ := crew["channels"].([]any)
	for _, c := range rows {
		row, _ := c.(map[string]any)
		name, _ := row["name"].(string)
		out[name] = row
	}
	return out
}

// A private channel the rider is not named into is absent — its name, its
// people, its unread count and its plan (#2444's bar). Presence never pierces
// a gate the page itself would refuse.
func TestAPrivateChannelNobodyNamedYouIntoIsNotInYourSidebar(t *testing.T) {
	h := setup(t)
	live := &fakeLive{present: map[string]protocol.RoomPresence{}}
	h.svc.SetLive(live)
	open := h.create(t, "voice", "Open ride", false)
	coaches := h.create(t, "voice", "Coaches", true)
	live.present[coaches] = protocol.RoomPresence{Riders: []string{"dave"}, RiderIDs: []string{store.UUIDString(h.users.ByToken["dave"].ID)}}
	live.present[open] = protocol.RoomPresence{Riders: []string{"alice"}, RiderIDs: []string{store.UUIDString(h.users.ByToken["alice"].ID)}, Voice: []string{"alice"}}
	if _, err := h.store.Pool.Exec(t.Context(),
		`insert into scheduled_sessions (crew_id, channel_id, workout_name, workout_json, starts_at, created_by)
		 values ($1, $2, 'Coaches only', '{}', $3, $4)`,
		h.crew, coaches, time.Now().Add(time.Hour), h.users.ByToken["alice"].ID); err != nil {
		t.Fatalf("plan: %v", err)
	}

	bob := h.liveCrew(t, "bob")
	if bob == nil {
		t.Fatal("bob's sidebar has no entry for his own crew")
	}
	seen := channelsOf(bob)
	if _, ok := seen["Coaches"]; ok {
		t.Error("bob's sidebar names a private channel nobody named him into")
	}
	if bob["next"] != nil {
		t.Errorf("bob's sidebar shows a plan in a private channel he may not enter: %v", bob["next"])
	}
	occupants, _ := seen["Open ride"]["occupants"].([]any)
	if len(occupants) != 1 {
		t.Fatalf("the open channel's occupants = %v, want alice", occupants)
	}
	if who, _ := occupants[0].(map[string]any); who["name"] != "alice" || who["voice"] != true {
		t.Errorf("the occupant reads %v, want alice in voice", who)
	}

	// An admin enters every channel, and sees its plan.
	dave := h.liveCrew(t, "dave")
	if _, ok := channelsOf(dave)["Coaches"]; !ok {
		t.Error("an admin's sidebar is missing a private channel")
	}
	if next, _ := dave["next"].(map[string]any); next["workoutName"] != "Coaches only" {
		t.Errorf("the admin's next plan = %v", dave["next"])
	}
	// Outside the crew, or banned from it: no entry at all.
	for _, who := range []string{"carol", "erin"} {
		if h.liveCrew(t, who) != nil {
			t.Errorf("%s's sidebar has the crew in it", who)
		}
	}
	if status, _ := h.call(t, "", http.MethodGet, "/api/crews/live", ""); status != http.StatusUnauthorized {
		t.Errorf("signed out: %d, want 401", status)
	}
}

// Unread per text channel: lines from others since the rider last read it.
func TestUnreadCountsPerTextChannel(t *testing.T) {
	h := setup(t)
	general := h.create(t, "text", "general", false)
	h.create(t, "text", "quiet", false)
	say := func(who, channel, text string) {
		t.Helper()
		if _, err := h.store.Pool.Exec(t.Context(),
			`insert into chat_messages (channel_id, user_id, text, created_at) values ($1, $2, $3, now())`,
			channel, h.users.ByToken[who].ID, text); err != nil {
			t.Fatalf("say: %v", err)
		}
	}
	say("alice", general, "tonight at seven")
	say("alice", general, "bring bottles")
	say("bob", general, "in")

	unread := func(who string) map[string]any {
		t.Helper()
		out := map[string]any{}
		for name, row := range channelsOf(h.liveCrew(t, who)) {
			out[name] = row["unread"]
		}
		return out
	}
	// Bob's own line is not news to bob.
	if got := unread("bob"); got["general"] != float64(2) || got["quiet"] != nil {
		t.Errorf("bob's unread = %v, want general 2 and quiet none", got)
	}
	if _, err := h.store.Pool.Exec(t.Context(),
		`insert into channel_reads (channel_id, user_id, read_at) values ($1, $2, now())`,
		general, h.users.ByToken["bob"].ID); err != nil {
		t.Fatalf("read: %v", err)
	}
	if got := unread("bob"); got["general"] != nil {
		t.Errorf("after reading, bob's unread = %v, want none", got)
	}
}
