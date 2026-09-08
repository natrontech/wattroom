package hub

import (
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/workout"
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
	// Parsed once at start for the live meter; nil when the JSON is junk.
	segments []workout.Segment
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
	s.segments, _ = workout.Parse(s.workoutJSON)
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

// SessionMood is what the room's timeline is asking of its riders right now
// (#270), handed to autoplay so a refill can match the music to the work.
// The zero value means "no preference" — nothing running, or a block that
// asks for nothing in particular — and leaves the draw exactly as #269 left
// it. Defined here rather than in the workout package because it is a
// summary FOR the deck, not a piece of the workout model.
type SessionMood struct {
	// The current block's target as a fraction of FTP; 0 when there is no
	// fraction that describes the room (an absolute-watts block, a sprint).
	TargetPct float64
	// The block's cadence band in rpm when it carries one (#66); 0 for
	// either bound means the workout did not say.
	CadenceLow, CadenceHigh int
}

// mood reads the timeline WITHOUT advancing it. state() promotes a finished
// countdown to "running" as a side effect of being called, and a jukebox
// refill must never be the thing that starts a session.
func (s *session) mood(now time.Time) SessionMood {
	if s.phase != "running" {
		return SessionMood{}
	}
	elapsed := int((s.banked + now.Sub(s.startedAt)).Seconds())
	seg, pct, ok := workout.SegmentAt(s.segments, elapsed)
	if !ok {
		return SessionMood{}
	}
	return SessionMood{TargetPct: pct, CadenceLow: seg.CadenceLow, CadenceHigh: seg.CadenceHigh}
}
