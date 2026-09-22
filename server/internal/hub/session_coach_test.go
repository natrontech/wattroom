package hub

// The session as a crew object (#2438, docs/SPEC.md's roles matrix): one per
// voice channel, opened by whoever picks first, driven by its coach until
// they hand it off, and ended by the coach or the crew's owner or an admin.

import (
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// as is a rider by id, a plain member, named for their id.
func as(id string) protocol.Rider { return protocol.Rider{ID: id, Name: id, Role: "member"} }

// ran reads control's answer: no code is "it ran".
func ran(code, _ string) bool { return code == "" }

var openers = protocol.Control{Action: "pick", WorkoutName: "Openers", WorkoutJSON: "{}", TotalSeconds: 600}

// inChannel is a room with these riders standing in it, so a hand-off and a
// refusal can name them.
func inChannel(t *testing.T, channel string, riders ...protocol.Rider) (*room, map[string]*client) {
	t.Helper()
	rm := newRoom(channel)
	clients := map[string]*client{}
	for _, rider := range riders {
		c := &client{rider: rider, out: make(chan []byte, clientQueue)}
		rm.join(c)
		clients[rider.ID] = c
	}
	return rm, clients
}

// expect runs one control and checks its answer's code ("" for "it ran").
func expect(t *testing.T, rm *room, c protocol.Control, rider protocol.Rider, want string) string {
	t.Helper()
	code, message := rm.control(c, rider, time.Now())
	if code != want {
		t.Fatalf("%s's %q answered %q (%s), want %q", rider.ID, c.Action, code, message, want)
	}
	return message
}

func TestSessionOnePerChannel(t *testing.T) {
	ana, ben := protocol.Rider{ID: "ana", Name: "Ana", Role: "member"}, protocol.Rider{ID: "ben", Name: "Ben", Role: "member"}
	cave, clients := inChannel(t, "pain-cave", ana, ben)

	// Any member opens one with a pick, and is its coach.
	expect(t, cave, openers, ana, "")
	state := cave.session.state(time.Now())
	if state.ID == "" || state.Coach != "ana" || state.CoachName != "Ana" {
		t.Fatalf("the pick opened %+v, want a session coached by Ana", state)
	}
	// A second one in the same channel is refused, and says whose it is —
	// while it is picked and while it runs.
	if message := expect(t, cave, openers, ben, "conflict"); !strings.Contains(message, "Ana") {
		t.Errorf("the refusal does not name the coach: %q", message)
	}
	expect(t, cave, protocol.Control{Action: "start"}, ben, "conflict")
	expect(t, cave, protocol.Control{Action: "start"}, ana, "")
	expect(t, cave, openers, ben, "conflict")

	// A second channel of the same crew runs its own, at the same time, on
	// its own tick.
	loft, loftClients := inChannel(t, "the-loft", ben)
	expect(t, loft, openers, ben, "")
	expect(t, loft, protocol.Control{Action: "start"}, ben, "")
	caveID, loftID := cave.session.id, loft.session.id
	if caveID == loftID {
		t.Fatal("two channels share one session id")
	}
	for _, rm := range []*room{cave, loft} {
		go rm.run(slog.New(slog.DiscardHandler), time.Now, nil)
		t.Cleanup(func() { close(rm.stop) })
	}
	for who, c := range map[string]*client{"cave": clients["ana"], "loft": loftClients["ben"]} {
		want := map[string]string{"cave": caveID, "loft": loftID}[who]
		if got := tickSession(t, c); got.ID != want || got.Phase != "countdown" {
			t.Errorf("the %s's tick carried %+v, want its own session %s counting down", who, got, want)
		}
	}
}

// The close snapshots a session on the tick after it ends; the next pick
// waits for it, then opens a new session with its own id and coach.
func TestTheNextSessionWaitsForTheLastOnesClose(t *testing.T) {
	ana, ben := as("ana"), as("ben")
	rm, _ := inChannel(t, "pain-cave", ana, ben)
	expect(t, rm, openers, ana, "")
	expect(t, rm, protocol.Control{Action: "start"}, ana, "")
	first := rm.session.id
	expect(t, rm, protocol.Control{Action: "end"}, ana, "")
	expect(t, rm, openers, ben, "conflict")

	rm.closeLocked(rm.session.state(time.Now()), time.Now(), false)
	expect(t, rm, openers, ben, "")
	if rm.session.id == first || rm.session.coach != "ben" {
		t.Fatalf("the next session is %q coached by %q, want a new id coached by ben", rm.session.id, rm.session.coach)
	}
}

func TestHandOff(t *testing.T) {
	ana, ben := protocol.Rider{ID: "ana", Name: "Ana", Role: "member"}, protocol.Rider{ID: "ben", Name: "Ben", Role: "member"}
	rm, _ := inChannel(t, "pain-cave", ana, ben)

	// Nothing to hand off before there is a session.
	expect(t, rm, protocol.Control{Action: "handoff", Rider: "ben"}, ana, "invalid_request")

	expect(t, rm, openers, ana, "")
	expect(t, rm, protocol.Control{Action: "start"}, ana, "")
	// Only the coach hands it on, and only to someone in the channel.
	expect(t, rm, protocol.Control{Action: "handoff", Rider: "ana"}, ben, "forbidden")
	expect(t, rm, protocol.Control{Action: "handoff", Rider: "nobody"}, ana, "invalid_request")
	expect(t, rm, protocol.Control{Action: "handoff", Rider: "ben"}, ana, "")
	if state := rm.session.state(time.Now()); state.Coach != "ben" || state.CoachName != "Ben" {
		t.Fatalf("after the hand-off the coach is %q (%q), want Ben", state.Coach, state.CoachName)
	}
	// The controls went with it.
	expect(t, rm, protocol.Control{Action: "sprint"}, ana, "forbidden")
	later := time.Now().Add(30 * time.Second)
	rm.session.state(later) // the countdown runs out
	code, _ := rm.control(protocol.Control{Action: "pause"}, ana, later)
	if code != "forbidden" {
		t.Fatalf("the old coach paused: %q", code)
	}
	if code, message := rm.control(protocol.Control{Action: "pause"}, ben, later); code != "" {
		t.Fatalf("the new coach could not pause: %s %s", code, message)
	}
}

func TestAdminEnds(t *testing.T) {
	ana := as("ana")
	admin := protocol.Rider{ID: "cleo", Name: "Cleo", Role: "admin"}
	owner := protocol.Rider{ID: "olli", Name: "Olli", Role: "owner"}
	member := as("dan")
	rm, _ := inChannel(t, "pain-cave", ana, admin, owner, member)

	expect(t, rm, openers, ana, "")
	expect(t, rm, protocol.Control{Action: "start"}, ana, "")
	// Ending is the one lever the crew's owner and admins hold over a
	// session somebody else is coaching (SPEC ‡): not pausing, not handing.
	expect(t, rm, protocol.Control{Action: "sprint"}, admin, "forbidden")
	expect(t, rm, protocol.Control{Action: "handoff", Rider: "cleo"}, owner, "forbidden")
	expect(t, rm, protocol.Control{Action: "end"}, member, "forbidden")
	expect(t, rm, protocol.Control{Action: "end"}, admin, "")
	if phase := rm.session.state(time.Now()).Phase; phase != "done" {
		t.Fatalf("the admin's end left the session %q", phase)
	}

	// A pick left behind would hold the channel shut; the owner clears it,
	// and nothing ran, so there is no session left to wait for.
	other, _ := inChannel(t, "the-loft", ana, owner, member)
	expect(t, other, openers, ana, "")
	expect(t, other, protocol.Control{Action: "end"}, owner, "")
	if other.session.id != "" {
		t.Fatalf("the owner's end left session %q open", other.session.id)
	}
	expect(t, other, openers, member, "")
}

// tickSession is the session on the next tick a client is handed.
func tickSession(t *testing.T, c *client) protocol.SessionState {
	t.Helper()
	select {
	case frame := <-c.out:
		var msg protocol.ServerMessage
		if err := json.Unmarshal(frame, &msg); err != nil || msg.Tick == nil {
			t.Fatalf("not a tick: %v: %s", err, frame)
		}
		return msg.Tick.State
	case <-time.After(3 * time.Second):
		t.Fatal("no tick arrived")
		return protocol.SessionState{}
	}
}
