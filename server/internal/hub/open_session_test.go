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
		before    func(h *Hub, rm *channelState)
		wantCode  string
		wantPhase string
		wantName  string
		wantTotal int
		wantCoach string
	}{
		{
			name:      "an empty channel counts down the plan with its starter coaching",
			before:    func(*Hub, *channelState) {},
			wantPhase: "countdown", wantName: "Thursday", wantTotal: 600, wantCoach: "alice",
		},
		{
			name: "a pick of the starter's own, left idle, gives way to the plan",
			before: func(h *Hub, rm *channelState) {
				if code, msg := rm.control(pick, alice, h.now()); code != "" {
					t.Fatalf("pick: %s %s", code, msg)
				}
			},
			wantPhase: "countdown", wantName: "Thursday", wantTotal: 600, wantCoach: "alice",
		},
		{
			name: "the plan already under way is started, not refused",
			before: func(h *Hub, rm *channelState) {
				if _, code, msg := h.OpenSession("track", alice, "Thursday", plan, nil, ""); code != "" {
					t.Fatalf("first start: %s %s", code, msg)
				}
			},
			wantPhase: "countdown", wantName: "Thursday", wantTotal: 600, wantCoach: "alice",
		},
		{
			name: "a different ride of the starter's own is not the plan (#2606)",
			before: func(h *Hub, rm *channelState) {
				for _, c := range []protocol.Control{pick, {Action: "start"}} {
					if code, msg := rm.control(c, alice, h.now()); code != "" {
						t.Fatalf("%s: %s %s", c.Action, code, msg)
					}
				}
			},
			wantCode:  "conflict",
			wantPhase: "countdown", wantName: "Other", wantTotal: 60, wantCoach: "alice",
		},
		{
			name: "someone else's session keeps the channel, and says who",
			before: func(h *Hub, rm *channelState) {
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
			rm := h.stateOf("track")
			tt.before(h, rm)

			id, code, _ := h.OpenSession("track", alice, "Thursday", plan, nil, "")
			if code != tt.wantCode {
				t.Fatalf("code = %q, want %q", code, tt.wantCode)
			}
			// The starter is taken to it (#2599): an id with every start,
			// the session's own, and none with a refusal.
			rm.mu.Lock()
			want := rm.session.id
			rm.mu.Unlock()
			if code != "" && id != "" || code == "" && (id == "" || id != want) {
				t.Fatalf("id = %q with code %q, want %q", id, code, want)
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

// A plan on a road opens its session on that road (#3103), from the metre
// the plan names on the crew's cut, and the bunch starts there; a route the
// planner does not own is refused, and nothing is picked.
func TestOpenSessionRidesThePlansRoad(t *testing.T) {
	const plan = `{"name":"Next leg","steps":[{"type":"steady","seconds":600,"target":0.75}]}`
	alice := protocol.Rider{ID: "alice", Name: "Alice", Role: "member"}
	h := New(slog.New(slog.DiscardHandler), nil, nil)
	h.SetRoads(fakeRoads{heights: slope(0, 20_000).Heights})
	route := &protocol.ControlRoute{ID: homeLoop, FromM: 5000}
	if _, code, msg := h.OpenSession("track", alice, "Next leg", plan, route, "bob"); code != "" {
		t.Fatalf("open: %s %s", code, msg)
	}
	rm := h.stateOf("track")
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if r := rm.session.route; r == nil || r.FromM != 5000 || r.ID != homeLoop {
		t.Fatalf("the session rides %+v, want the plan's road from 5000 m", rm.session.route)
	}
	if b := rm.session.bunch; b == nil || b.fromM+b.pace.Distance != 5000 {
		t.Fatalf("the bunch starts at %+v, want 5000 m", rm.session.bunch)
	}

	refused := New(slog.New(slog.DiscardHandler), nil, nil)
	refused.SetRoads(fakeRoads{refused: &protocol.Error{Code: "not_found", Message: "That route is not one of yours."}})
	if _, code, _ := refused.OpenSession("track", alice, "Next leg", plan, route, "bob"); code != "not_found" {
		t.Fatalf("a route the planner does not own answered %q, want not_found", code)
	}
	if s := refused.stateOf("track").session; s.workoutName != "" {
		t.Fatalf("a refused road still picked %q", s.workoutName)
	}
}
