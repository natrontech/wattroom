package crews

import (
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"
)

// countingPresence is the hub seen from crews: how often the lobby was told
// to re-fetch (#570). Locked (#1718): sequential today, one `go` statement
// away from an intermittent -race failure otherwise.
type countingPresence struct {
	fakePresence
	mu    sync.Mutex
	pings int
}

func (p *countingPresence) PresenceChanged() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.pings++
}

func (p *countingPresence) count() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.pings
}

// A crew changes for everyone in it, not just for whoever changed it: every
// durable mutation has to ping the lobby, or the other clients keep showing
// the crew as it stood when they opened it.
func TestCrewMutationsPingTheLobby(t *testing.T) {
	h := setup(t)
	presence := &countingPresence{}
	h.svc.SetPresence(presence)
	crew := h.newCrew(t, "alice", "Ping Test Crew")
	bob := h.userID(t, "bob")
	soon := time.Now().Add(2 * time.Hour).UTC().Format(time.RFC3339)

	cases := []struct {
		name, user, method, path, body string
		want                           int
	}{
		{"join the crew by code", "bob", http.MethodPost, "/api/crews/join", fmt.Sprintf(`{"code":%q}`, codeOf(crew.Code)), http.StatusOK},
		{"rename", "alice", http.MethodPatch, crewPath(crew), `{"name":"Ping Test Crew 2"}`, http.StatusOK},
		{"promote", "alice", http.MethodPost, crewPath(crew, "/role"),
			fmt.Sprintf(`{"userId":%q,"role":"admin"}`, bob), http.StatusNoContent},
		{"plan a session", "alice", http.MethodPost, crewPath(crew, "/schedule"),
			fmt.Sprintf(`{"workoutName":"Threshold","workoutJson":%q,"startsAt":%q}`,
				`{"name":"Threshold","steps":[{"type":"steady","seconds":600,"target":0.85}]}`, soon),
			http.StatusCreated},
		{"ban a member", "alice", http.MethodPost, crewPath(crew, "/role"),
			fmt.Sprintf(`{"userId":%q,"role":"banned"}`, bob), http.StatusNoContent},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := presence.count()
			status, body := h.call(t, tc.user, tc.method, tc.path, tc.body)
			if status != tc.want {
				t.Fatalf("%s: %d %v", tc.name, status, body)
			}
			if presence.count() == before {
				t.Errorf("%s did not ping the lobby — everyone else stays stale until they reload", tc.name)
			}
		})
	}
}
