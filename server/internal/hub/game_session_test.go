package hub

// A game is a session (docs/SPEC.md's glossary, #2597): it opens one, its
// riders' rides are kept, its coach — and a crew admin — ends it, and it
// closes with the game.

import (
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// gameChannel is a channel on a hand-moved clock with these riders in it.
func gameChannel(t *testing.T, now *time.Time, riders ...protocol.Rider) (*room, map[string]*client) {
	t.Helper()
	rm := presenceRoom(now)
	clients := map[string]*client{}
	for _, rider := range riders {
		c := &client{rider: rider, out: make(chan []byte, clientQueue)}
		rm.join(c)
		clients[rider.ID] = c
	}
	return rm, clients
}

// finished is a mode that has already ended — what a game reaching its own
// end looks like to the room.
type finished struct{}

func (finished) advance(time.Time, map[string]int, map[string]protocol.Rider) {}
func (finished) state(time.Time) protocol.GameState {
	return protocol.GameState{Mode: "watt-golf", Phase: "done"}
}
func (finished) done() bool { return true }

func TestGameOpensASession(t *testing.T) {
	now := pat(0)
	ana, ben := protocol.Rider{ID: "ana", Name: "Ana", Role: "member"}, protocol.Rider{ID: "ben", Name: "Ben", Role: "member"}
	rm, clients := gameChannel(t, &now, ana, ben)

	if refusal := rm.startGame("floor-is-lava", ana, now); refusal != "" {
		t.Fatalf("start: %s", refusal)
	}
	s := rm.session
	if !s.open() || s.phase != "running" || s.coach != "ana" || s.workoutName != "Floor is Lava" {
		t.Fatalf("session = open %v, %s, coached by %q, named %q; want a running one Ana coaches, named for the mode",
			s.open(), s.phase, s.coach, s.workoutName)
	}
	// The saver parses it and scores nothing: a game prescribes no target.
	if _, err := workout.Parse(s.workoutJSON); err != nil || !workout.Unscored(s.workoutJSON) {
		t.Fatalf("workout %q: parse err %v, unscored %v", s.workoutJSON, err, workout.Unscored(s.workoutJSON))
	}

	// Its riders' samples are a ride record, as a workout's are.
	joinRide(rm, "ben")
	rm.setMetrics(clients["ben"], protocol.RiderMetrics{Watts: 180, Cadence: 90, Seq: 1})
	if rm.record.count("ben") != 1 {
		t.Fatalf("Ben's sample was not recorded: %d", rm.record.count("ben"))
	}

	// The coach's, as a session's controls are: not Ben's to end.
	if code, _ := rm.control(protocol.Control{Action: "game-end"}, ben, now); code != "forbidden" {
		t.Fatalf("a member ended someone else's game: %q", code)
	}
	// A game keeps its own clock and its own sprints. The sprint is armed
	// off the socket, so it is the refusal that answers it.
	if code, _ := rm.control(protocol.Control{Action: "pause"}, ana, now); code != "invalid_request" {
		t.Fatalf("pause in a game answered %q, want invalid_request", code)
	}
	rm.mu.Lock()
	code, _ := rm.refusalLocked("sprint", ana)
	rm.mu.Unlock()
	if code != "invalid_request" {
		t.Fatalf("a coach's sprint in a game answered %q, want invalid_request", code)
	}

	// Ending the game closes its session, and the close saves it.
	now = pat(90)
	if !rm.endGame(now) {
		t.Fatal("end: no game")
	}
	state := rm.session.state(now)
	if state.Phase != "done" {
		t.Fatalf("after the game the session is %s, want done", state.Phase)
	}
	rm.mu.Lock()
	end := rm.closeLocked(state, now, true)
	rm.mu.Unlock()
	if end == nil || len(end.records) != 1 || end.records[0].Rider.ID != "ben" {
		t.Fatalf("the close handed over %+v, want Ben's ride", end)
	}
}

func TestGameSessionEnds(t *testing.T) {
	ana := protocol.Rider{ID: "ana", Name: "Ana", Role: "member"}
	admin := protocol.Rider{ID: "cleo", Name: "Cleo", Role: "admin"}

	t.Run("when the game reaches its own end", func(t *testing.T) {
		now := pat(0)
		rm, _ := gameChannel(t, &now, ana)
		if refusal := rm.startGame("watt-golf", ana, now); refusal != "" {
			t.Fatalf("start: %s", refusal)
		}
		rm.game = finished{}
		rm.mu.Lock()
		rm.advanceGameLocked(pat(30))
		rm.mu.Unlock()
		if rm.session.phase != "done" {
			t.Fatalf("a finished game left its session %s", rm.session.phase)
		}
		// The podium stays up while the rides are saved.
		if rm.game == nil {
			t.Fatal("the finished game's podium went with its session")
		}
	})

	t.Run("when a crew admin ends it, the game goes too", func(t *testing.T) {
		now := pat(0)
		rm, _ := gameChannel(t, &now, ana, admin)
		if refusal := rm.startGame("team-relay", ana, now); refusal != "" {
			t.Fatalf("start: %s", refusal)
		}
		if code, message := rm.control(protocol.Control{Action: "end"}, admin, now); code != "" {
			t.Fatalf("admin end: %s %s", code, message)
		}
		if rm.session.phase != "done" || rm.game != nil {
			t.Fatalf("after the admin's end: session %s, game still running %v", rm.session.phase, rm.game != nil)
		}
	})

	t.Run("when nobody is left, after the grace", func(t *testing.T) {
		now := pat(0)
		rm, clients := gameChannel(t, &now, ana)
		if refusal := rm.startGame("points-race", ana, now); refusal != "" {
			t.Fatalf("start: %s", refusal)
		}
		rm.mu.Lock()
		rm.sawLocked(now)
		rm.mu.Unlock()
		rm.leave(clients["ana"])

		sweep := func(at time.Time) {
			rm.mu.Lock()
			defer rm.mu.Unlock()
			rm.endAbandonedGameLocked(at)
		}
		sweep(pat(int(presenceGrace.Seconds()) - 1))
		if !rm.session.open() {
			t.Fatal("ended inside the grace — a reload would end the game")
		}
		sweep(pat(int(presenceGrace.Seconds()) + 1))
		if rm.session.open() || rm.game != nil {
			t.Fatalf("an abandoned game is still running: session %s", rm.session.phase)
		}
	})
}

func TestGameInsideAWorkoutRidesThatSession(t *testing.T) {
	now := pat(0)
	ana := protocol.Rider{ID: "ana", Name: "Ana", Role: "member"}
	rm, _ := gameChannel(t, &now, ana)
	for _, c := range []protocol.Control{openers, {Action: "start"}} {
		if code, message := rm.control(c, ana, now); code != "" {
			t.Fatalf("%s: %s %s", c.Action, code, message)
		}
	}
	id := rm.session.id
	if refusal := rm.startGame("sprint-roulette", ana, now); refusal != "" {
		t.Fatalf("start: %s", refusal)
	}
	if rm.session.id != id || rm.session.game != "" || rm.session.workoutName != "Openers" {
		t.Fatalf("the game replaced the workout's session: %q %q", rm.session.workoutName, rm.session.game)
	}
	rm.endGame(now)
	if !rm.session.open() {
		t.Fatal("ending a game inside a workout ended the workout")
	}
}

func TestGameSessionSaysItsEndOnce(t *testing.T) {
	now := pat(0)
	ana := protocol.Rider{ID: "ana", Name: "Ana", Role: "member"}
	rm, _ := gameChannel(t, &now, ana)
	if refusal := rm.startGame("team-relay", ana, now); refusal != "" {
		t.Fatalf("start: %s", refusal)
	}
	rm.mu.Lock()
	rm.sayPhaseLocked(rm.session.state(now), now)
	rm.mu.Unlock()
	rm.events.drain()
	rm.endGame(pat(60))
	rm.mu.Lock()
	rm.sayPhaseLocked(rm.session.state(pat(60)), pat(60))
	rm.mu.Unlock()
	var got []string
	for _, ev := range rm.events.pending {
		got = append(got, ev.Verb)
	}
	if len(got) != 1 || got[0] != "gameEnded" {
		t.Fatalf("lines at the end: %v, want the game's own one", got)
	}
}
