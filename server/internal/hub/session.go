package hub

import (
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// countdownSeconds is docs/SPEC.md's session-lifecycle default.
const countdownSeconds = 10

// session is the shared timeline's state machine, server-owned (the server
// owns shared truth; clients own their targets). Pure against an injected
// clock so the lifecycle is table-testable without a socket.
//
// Not goroutine-safe on its own — the owning room's mutex guards it.
type session struct {
	phase        string
	workoutName  string
	workoutJSON  string
	totalSeconds int
	// The instant the timeline (or countdown) started, and time carried over
	// from before the last pause.
	startedAt time.Time
	banked    time.Duration
}

func newSession() *session {
	return &session{phase: "idle"}
}

// pick loads a workout while idle or done; picking replaces, never mid-session.
func (s *session) pick(name, workoutJSON string, totalSeconds int) bool {
	if s.phase != "idle" && s.phase != "done" {
		return false
	}
	s.workoutName, s.workoutJSON, s.totalSeconds = name, workoutJSON, totalSeconds
	s.phase = "idle"
	return true
}

func (s *session) start(now time.Time) bool {
	if s.phase != "idle" || s.workoutJSON == "" {
		return false
	}
	s.phase = "countdown"
	s.startedAt = now
	s.banked = 0
	return true
}

func (s *session) pause(now time.Time) bool {
	if s.phase != "running" {
		return false
	}
	s.banked += now.Sub(s.startedAt)
	s.phase = "paused"
	return true
}

func (s *session) resume(now time.Time) bool {
	if s.phase != "paused" {
		return false
	}
	s.startedAt = now
	s.phase = "running"
	return true
}

func (s *session) end() bool {
	if s.phase == "idle" || s.phase == "done" {
		return false
	}
	s.phase = "done"
	return true
}

// state renders the truth at `now`, advancing countdown->running and
// running->done as the clock demands. Called from the tick, so transitions
// happen even if no message ever arrives.
func (s *session) state(now time.Time) protocol.SessionState {
	if s.phase == "countdown" {
		remaining := countdownSeconds - int(now.Sub(s.startedAt).Seconds())
		if remaining > 0 {
			return protocol.SessionState{
				Phase: "countdown", CountdownRemaining: remaining,
				WorkoutName: s.workoutName, WorkoutJSON: s.workoutJSON, TotalSeconds: s.totalSeconds,
			}
		}
		// The countdown elapsed; the timeline started the instant it hit zero.
		s.phase = "running"
		s.startedAt = s.startedAt.Add(countdownSeconds * time.Second)
		s.banked = 0
	}

	elapsed := int(s.banked.Seconds())
	if s.phase == "running" {
		elapsed = int((s.banked + now.Sub(s.startedAt)).Seconds())
		if s.totalSeconds > 0 && elapsed >= s.totalSeconds {
			// The timeline ran out: the session closes itself (SPEC lifecycle) —
			// the coach ending it early is the exception, not the mechanism.
			s.phase = "done"
			elapsed = s.totalSeconds
		}
	}
	if s.phase == "done" && s.totalSeconds > 0 && elapsed > s.totalSeconds {
		elapsed = s.totalSeconds
	}

	return protocol.SessionState{
		Phase: s.phase, Elapsed: elapsed,
		WorkoutName: s.workoutName, WorkoutJSON: s.workoutJSON, TotalSeconds: s.totalSeconds,
	}
}

// apply runs one control message; the caller has already checked the role.
func (s *session) apply(c protocol.Control, now time.Time) bool {
	switch c.Action {
	case "pick":
		return s.pick(c.WorkoutName, c.WorkoutJSON, c.TotalSeconds)
	case "start":
		return s.start(now)
	case "pause":
		return s.pause(now)
	case "resume":
		return s.resume(now)
	case "end":
		return s.end()
	default:
		return false
	}
}
