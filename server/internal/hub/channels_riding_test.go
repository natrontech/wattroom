package hub

import (
	"log/slog"
	"slices"
	"testing"
)

// The road endpoint asks which channels ride a route (#3096): a channel whose
// open session rides it, and no other — not one riding another road, not one
// whose session has ended, not one with no session.
func TestChannelsRidingIsTheOpenSessionsOnThatRoute(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	ride := func(channel, route, phase string) {
		rm := h.stateOf(channel)
		rm.mu.Lock()
		defer rm.mu.Unlock()
		rm.session.begin("s-"+channel, "coach", "Coach")
		rm.session.phase = phase
		if route != "" {
			rm.session.route = rideOn(slope(2, 3000), 0, false, false)
			rm.session.route.ID = route
		}
	}
	ride("riding", "home", "running")
	ride("waiting", "home", "idle")
	ride("elsewhere", "away", "running")
	ride("over", "home", "done")
	ride("roadless", "", "running")
	got := h.ChannelsRiding("home")
	slices.Sort(got)
	if !slices.Equal(got, []string{"riding", "waiting"}) {
		t.Fatalf("channels riding home: %v, want [riding waiting]", got)
	}
}
