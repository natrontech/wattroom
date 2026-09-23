package hub

import (
	"log/slog"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// A plan started from the crew's Schedule (#2440) runs, rather than being
// picked and left idle with the plan already spent (#2535).
func TestOpenSessionStartsThePlan(t *testing.T) {
	const plan = `{"name":"Thursday","steps":[{"type":"steady","seconds":600,"target":0.75}]}`
	alice := protocol.Rider{ID: "alice", Name: "Alice", Role: "member"}
	bob := protocol.Rider{ID: "bob", Name: "Bob", Role: "member"}
	pick := protocol.Control{Action: "pick", WorkoutName: "Other", WorkoutJSON: `{"name":"Other","steps":[{"type":"steady","seconds":60,"target":0.5}]}`}

	tests := []struct {
		name      string
		before    func(h *Hub, rm *room)
		wantCode  string
		wantPhase string
		wantName  string
		wantTotal int
		wantCoach string
	}{
		{
			name:      "an empty channel counts down the plan with its starter coaching",
			before:    func(*Hub, *room) {},
			wantPhase: "countdown", wantName: "Thursday", wantTotal: 600, wantCoach: "alice",
		},
		{
			name: "a pick of the starter's own, left idle, gives way to the plan",
			before: func(h *Hub, rm *room) {
				if code, msg := rm.control(pick, alice, h.now()); code != "" {
					t.Fatalf("pick: %s %s", code, msg)
				}
			},
			wantPhase: "countdown", wantName: "Thursday", wantTotal: 600, wantCoach: "alice",
		},
		{
			name: "someone else's session keeps the channel, and says who",
			before: func(h *Hub, rm *room) {
				if code, msg := rm.control(pick, bob, h.now()); code != "" {
					t.Fatalf("pick: %s %s", code, msg)
				}
			},
			wantCode:  "conflict",
			wantPhase: "idle", wantName: "Other", wantTotal: 60, wantCoach: "bob",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
			rm := h.room("track")
			tt.before(h, rm)

			code, _ := h.OpenSession("track", alice, "Thursday", plan)
			if code != tt.wantCode {
				t.Fatalf("code = %q, want %q", code, tt.wantCode)
			}
			rm.mu.Lock()
			s := rm.session
			rm.mu.Unlock()
			if s.phase != tt.wantPhase || s.workoutName != tt.wantName ||
				s.totalSeconds != tt.wantTotal || s.coach != tt.wantCoach {
				t.Errorf("session = %s %q %ds coached by %q, want %s %q %ds coached by %q",
					s.phase, s.workoutName, s.totalSeconds, s.coach,
					tt.wantPhase, tt.wantName, tt.wantTotal, tt.wantCoach)
			}
		})
	}
}
