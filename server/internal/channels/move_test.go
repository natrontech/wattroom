package channels

import (
	"fmt"
	"net/http"
	"slices"
	"testing"

	"github.com/natrontech/wattroom/server/internal/hub"
	"github.com/natrontech/wattroom/server/internal/store"
)

// Only the crew's owner and admins move a rider (#2730), only between the
// crew's own voice channels, and never through a door the rider could not
// walk through themselves.
func TestMoveBetweenVoiceChannels(t *testing.T) {
	h := setup(t)
	live := &fakeLive{}
	h.svc.SetLive(live)
	cave := h.create(t, "voice", "Cave", false)
	lair := h.create(t, "voice", "Lair", false)
	coaches := h.create(t, "voice", "Coaches", true)
	general := h.create(t, "text", "general", false)
	id := func(who string) string { return store.UUIDString(h.users.ByToken[who].ID) }
	body := func(rider, from string) string { return fmt.Sprintf(`{"rider":%q,"from":%q}`, rider, from) }

	for _, tc := range []struct {
		name, caller, to, body string
		fails                  error
		want                   int
	}{
		{"no auth", "", lair, body(id("bob"), cave), nil, http.StatusUnauthorized},
		{"a member may not", "bob", lair, body(id("dave"), cave), nil, http.StatusForbidden},
		{"unreadable", "alice", lair, `{"rider":`, nil, http.StatusBadRequest},
		{"into a text channel", "alice", general, body(id("bob"), cave), nil, http.StatusBadRequest},
		{"out of a text channel", "alice", lair, body(id("bob"), general), nil, http.StatusNotFound},
		{"where they are", "alice", cave, body(id("bob"), cave), nil, http.StatusBadRequest},
		{"no such channel", "alice", "00000000-0000-0000-0000-000000000000", body(id("bob"), cave), nil, http.StatusNotFound},
		{"somebody outside the crew", "alice", lair, body(id("carol"), cave), nil, http.StatusNotFound},
		{"a banned rider", "alice", lair, body(id("erin"), cave), nil, http.StatusNotFound},
		{"a member into a private one they are not named in", "alice", coaches, body(id("bob"), cave), nil, http.StatusForbidden},
		{"already left", "alice", lair, body(id("bob"), cave), hub.ErrNotInChannel, http.StatusConflict},
		{"riding", "alice", lair, body(id("bob"), cave), hub.ErrRiding, http.StatusConflict},
		{"an admin into a private one by role", "dave", coaches, body(id("dave"), cave), nil, http.StatusNoContent},
		{"the owner moves a member", "alice", lair, body(id("bob"), cave), nil, http.StatusNoContent},
	} {
		t.Run(tc.name, func(t *testing.T) {
			live.moved, live.moveErr = nil, tc.fails
			status, resp := h.call(t, tc.caller, http.MethodPost, "/api/channels/"+tc.to+"/move", tc.body)
			if status != tc.want {
				t.Fatalf("status %d %v, want %d", status, resp, tc.want)
			}
			if status != http.StatusNoContent {
				if msg, _ := resp["message"].(string); msg == "" {
					t.Errorf("a refusal without a message: %v", resp)
				}
				if tc.fails == nil && len(live.moved) > 0 {
					t.Errorf("refused, yet the hub was told to move %v", live.moved)
				}
			}
		})
	}
	if want := []string{cave + "/" + id("bob") + "->" + lair + " Lair by alice"}; !slices.Equal(live.moved, want) {
		t.Errorf("the hub was told %v, want %v", live.moved, want)
	}
}
