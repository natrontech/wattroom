package hub

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// keptPlans records what the hub gave back.
type keptPlans chan [2]string

func (k keptPlans) GiveBackPlan(_ context.Context, crew, plan string) error {
	k <- [2]string{crew, plan}
	return nil
}

// A session a plan opened (#4562): its planner may cancel it before the
// count-in ends even when someone else started it, another member may not,
// and the cancel puts the plan back on the calendar. After the count-in it
// is the coach's to end, and nothing is given back.
func TestCancelGivesThePlanBack(t *testing.T) {
	alice := protocol.Rider{ID: "alice", Name: "Alice", Role: "member"}
	bob := protocol.Rider{ID: "bob", Name: "Bob", Role: "member"}
	dan := protocol.Rider{ID: "dan", Name: "Dan", Role: "member"}
	for _, tc := range []struct {
		name    string
		after   time.Duration
		by      protocol.Rider
		refused string
		back    bool
	}{
		{"the planner, in the count-in", 0, bob, "", true},
		{"the coach, in the count-in", 0, alice, "", true},
		{"another member", 0, dan, "forbidden", false},
		{"the planner, once it runs", 2 * countdownSeconds * time.Second, bob, "forbidden", false},
		{"the coach, once it runs", 2 * countdownSeconds * time.Second, alice, "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
			kept := make(keptPlans, 1)
			h.SetPlanKeeper(kept)
			// Alice starts the plan Bob made.
			id, code, msg := h.OpenSession(protocol.CrewSessionPlace("crew1", ""), alice, "Tempo", crewWorkout, nil, "bob", "plan1", nil)
			if code != "" {
				t.Fatalf("open: %s %s", code, msg)
			}
			var rm *channelState
			for _, r := range h.liveChannels() {
				r.mu.Lock()
				if r.session.id == id {
					rm = r
				}
				r.mu.Unlock()
			}
			if rm == nil {
				t.Fatal("no room holds the plan's session")
			}
			now := h.now().Add(tc.after)
			rm.mu.Lock()
			if got := rm.session.state(now).PlanID; got != "plan1" {
				t.Fatalf("state names plan %q, want plan1", got)
			}
			rm.mu.Unlock()
			if code, _ := rm.control(protocol.Control{Action: "end"}, tc.by, now); code != tc.refused {
				t.Fatalf("end by %s = %q, want %q", tc.by.ID, code, tc.refused)
			}
			if !tc.back {
				rm.mu.Lock()
				pending := rm.givenBack
				rm.mu.Unlock()
				if pending != "" {
					t.Fatalf("plan %q waits to be given back", pending)
				}
				return
			}
			h.giveBackPlan(rm)
			select {
			case got := <-kept:
				if got != [2]string{"crew1", "plan1"} {
					t.Fatalf("gave back %v, want crew1's plan1", got)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("the plan was not given back")
			}
		})
	}
}
