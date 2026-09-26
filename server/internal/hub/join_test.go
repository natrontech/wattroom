package hub

import (
	"slices"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// joinRide puts riders on the session's timeline (ADR-0059). A test that
// built its timeline with a bare pick has no session id and gets one, since
// only an open session has riders.
func joinRide(rm *room, ids ...string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	joinRideLocked(rm, ids...)
}

// joinRideLocked is joinRide for a test already holding rm.mu.
func joinRideLocked(rm *room, ids ...string) {
	// A bare pick has no id and no coach; the first rider coaches it, as
	// the one who picks through control would.
	if rm.session.id == "" && len(ids) > 0 {
		rm.session.id, rm.session.coach = "test-session", ids[0]
	}
	if rm.session.joined == nil {
		rm.session.joined = map[string]struct{}{}
	}
	for _, id := range ids {
		rm.session.join(id, true)
	}
}

func TestASessionCountsOnlyWhoJoinedIt(t *testing.T) {
	// ADR-0059: a session starting in the channel used to take every rider
	// in it — a free rider spinning beside it landed in its record, its
	// sprint and its saved rides without ever choosing to ride it.
	coach, ben := as("coach"), as("ben")
	rm, clients := inChannel(t, "velvet", coach, ben)
	now := time.Now()
	rm.now = func() time.Time { return now }
	expect(t, rm, openers, coach, "")
	expect(t, rm, protocol.Control{Action: "start"}, coach, "")
	now = now.Add((countdownSeconds + 1) * time.Second)
	rm.session.state(now)

	seq := 0
	pedal := func() {
		seq++
		now = now.Add(time.Second)
		for _, c := range clients {
			rm.setMetrics(c, protocol.RiderMetrics{Watts: 200, Seq: seq})
		}
	}

	pedal()
	if rm.record.count("coach") != 1 {
		t.Fatalf("the coach who started it recorded %d samples, want 1", rm.record.count("coach"))
	}
	if _, counted := rm.seen["ben"]; counted || rm.record.count("ben") != 0 {
		t.Fatalf("a spectator was counted: seen %v, %d samples", counted, rm.record.count("ben"))
	}
	if _, ids := rm.ridingLocked(now); !slices.Contains(ids, "ben") {
		t.Fatalf("riding = %v: a spectator pedalling is still riding in the channel", ids)
	}

	expect(t, rm, protocol.Control{Action: "join"}, ben, "")
	pedal()
	if rm.record.count("ben") != 1 {
		t.Fatalf("after joining Ben recorded %d samples, want 1", rm.record.count("ben"))
	}

	expect(t, rm, protocol.Control{Action: "leave"}, ben, "")
	pedal()
	if rm.record.count("ben") != 1 {
		t.Fatalf("after leaving Ben recorded %d samples, want still 1", rm.record.count("ben"))
	}
	samples := []protocol.RiderMetrics{{Watts: 200, Seq: 90}}
	rm.backfill(clients["ben"], samples, nil, nil)
	if rm.record.count("ben") != 1 {
		t.Fatal("a spectator's replay landed in the session's record")
	}
}

// A session goes to someone riding in it (SPEC's roles, ADR-0059, #2829).
// A hand-off used to draft whoever it named onto the timeline — a free rider
// beside the session had their trainer taken over by somebody else's
// right-click, which is the takeover ADR-0059 exists to stop.
func TestJoiningNeedsASessionAndAHandOffNeedsARider(t *testing.T) {
	coach, ben := as("coach"), as("ben")
	rm, _ := inChannel(t, "velvet", coach, ben)
	expect(t, rm, protocol.Control{Action: "join"}, ben, "invalid_request")
	expect(t, rm, protocol.Control{Action: "leave"}, ben, "invalid_request")

	expect(t, rm, openers, coach, "")
	if !rm.session.rides("coach") || rm.session.rides("ben") {
		t.Fatal("the opener is not riding it, or a bystander is")
	}
	expect(t, rm, protocol.Control{Action: "handoff", Rider: "ben"}, coach, "invalid_request")
	if rm.session.rides("ben") || rm.session.coach != "coach" {
		t.Fatal("a hand-off drafted a bystander onto the timeline")
	}
	expect(t, rm, protocol.Control{Action: "join"}, ben, "")
	expect(t, rm, protocol.Control{Action: "handoff", Rider: "ben"}, coach, "")
	if rm.session.coach != "ben" {
		t.Fatal("a rider in the session could not take it")
	}
}
