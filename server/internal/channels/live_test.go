package channels

import (
	"net/http"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// What is running in the crew (#2438) is answered only for the voice channels
// the caller may enter: a session in a private channel is that channel's.
func TestLiveSessionsFollowTheGate(t *testing.T) {
	h := setup(t)
	live := &fakeLive{}
	h.svc.SetLive(live)
	open := h.create(t, "voice", "Pain Cave", false)
	private := h.create(t, "voice", "Coaches", true)
	h.create(t, "voice", "Quiet Room", false) // nothing running: no entry
	live.running = map[string]protocol.LiveSession{
		open:    {ID: "s1", Channel: open, Workout: "Openers", Phase: "running", Coach: "a", CoachName: "alice"},
		private: {ID: "s2", Channel: private, Workout: "Threshold", Phase: "paused", Coach: "d", CoachName: "dave"},
	}

	sessions := func(who string) map[string]bool {
		t.Helper()
		status, body := h.call(t, who, http.MethodGet, "/api/crews/"+h.crew+"/live", "")
		if status != http.StatusOK {
			t.Fatalf("%s: %d %v", who, status, body)
		}
		out := map[string]bool{}
		list, _ := body["sessions"].([]any)
		for _, item := range list {
			entry, _ := item.(map[string]any)
			id, _ := entry["id"].(string)
			out[id] = true
		}
		return out
	}
	if got := sessions("bob"); !got["s1"] || got["s2"] || len(got) != 1 {
		t.Errorf("a member sees %v, want the open channel's session alone", got)
	}
	if got := sessions("dave"); !got["s1"] || !got["s2"] {
		t.Errorf("an admin sees %v, want both — the private channel admits them by role", got)
	}
	for who, want := range map[string]int{"carol": http.StatusNotFound, "erin": http.StatusNotFound, "": http.StatusUnauthorized} {
		if status, _ := h.call(t, who, http.MethodGet, "/api/crews/"+h.crew+"/live", ""); status != want {
			t.Errorf("%q read the crew's live sessions: %d, want %d", who, status, want)
		}
	}
}
