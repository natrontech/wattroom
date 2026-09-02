package rooms

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// countingPresence is the hub seen from rooms: it only has to say how often
// the lobby was told to re-fetch (#570).
type countingPresence struct{ pings int }

func (p *countingPresence) Presence(string) protocol.RoomPresence                     { return protocol.RoomPresence{} }
func (p *countingPresence) Kick(string, string)                                       {}
func (p *countingPresence) SetRole(string, string, string)                            {}
func (p *countingPresence) SessionAnnounce(string, string, string, string, time.Time) {}
func (p *countingPresence) PresenceChanged()                                          { p.pings++ }

// A room changes for everyone in it, not just for whoever changed it: every
// durable mutation has to ping the lobby, or the other clients keep showing
// the room as it stood when they opened it.
func TestRoomMutationsPingTheLobby(t *testing.T) {
	h := setup(t)
	presence := &countingPresence{}
	h.svc.SetPresence(presence)
	slug, code := h.createRoom(t, "alice", "Ping Test Room")
	bob := h.userID(t, "bob")
	soon := time.Now().Add(2 * time.Hour).UTC().Format(time.RFC3339)

	cases := []struct {
		name, user, method, path, body string
		want                           int
	}{
		{"join by code", "bob", http.MethodPost, "/api/rooms/join", fmt.Sprintf(`{"code":%q}`, code), http.StatusOK},
		{"join by link", "carol", http.MethodPost, "/api/rooms/" + slug + "/join", "", http.StatusNoContent},
		{"rename", "alice", http.MethodPatch, "/api/rooms/" + slug, `{"name":"Ping Test Room 2","listed":false}`, http.StatusOK},
		{"promote", "alice", http.MethodPost, "/api/rooms/" + slug + "/role",
			fmt.Sprintf(`{"userId":%q,"role":"coach"}`, bob), http.StatusNoContent},
		{"plan a session", "alice", http.MethodPost, "/api/rooms/" + slug + "/schedule",
			fmt.Sprintf(`{"workoutName":"Threshold","workoutJson":%q,"startsAt":%q}`,
				`{"name":"Threshold","steps":[{"type":"steady","seconds":600,"target":0.85}]}`, soon),
			http.StatusCreated},
		{"remove a member", "alice", http.MethodDelete, "/api/rooms/" + slug + "/members/" + bob, "", http.StatusNoContent},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := presence.pings
			status, body := h.call(t, tc.user, tc.method, tc.path, tc.body)
			if status != tc.want {
				t.Fatalf("%s: %d %v", tc.name, status, body)
			}
			if presence.pings == before {
				t.Errorf("%s did not ping the lobby — everyone else stays stale until they reload", tc.name)
			}
		})
	}
}
