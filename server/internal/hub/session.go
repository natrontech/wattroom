package hub

import (
	"hash/fnv"
	"strconv"
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
	workoutHash  string
	totalSeconds int
	// The instant the timeline (or countdown) started, and time carried over
	// from before the last pause.
	startedAt time.Time
	banked    time.Duration
	// Parsed once at start for the live meter; nil when the JSON is junk.
	segments []workout.Segment
	// How many times this session has been started, so anything latched
	// against one run of the timeline lets go when a new one begins (#2016).
	// A new pick only reaches the timeline through a start, so this counts
	// workout changes too.
	run int
}

func newSession() *session {
	return &session{phase: "idle"}
}

// pick loads a workout while idle or done; picking replaces, never mid-session.
// The workout's own length is the session's (#1708): the coach's socket used
// to send totalSeconds and the server believed it — too large and the
// timeline never closed, too small and every rider's ride was cut. The
// client's number stands only for a workout with no blocks (the tests' "{}").
func (s *session) pick(name, workoutJSON string, totalSeconds int) bool {
	if s.phase != "idle" && s.phase != "done" {
		return false
	}
	s.workoutName, s.workoutJSON, s.totalSeconds = name, workoutJSON, totalSeconds
	s.workoutHash = workoutHash(workoutJSON)
	if segments, err := workout.Parse(workoutJSON); err == nil && len(segments) > 0 {
		last := segments[len(segments)-1]
		s.totalSeconds = last.Start + last.Seconds
	}
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
	s.run++
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

// end closes the session where the clock stands. The time is BANKED, not
// implied: state() reads a done session's elapsed from banked alone, and a
// close that left it at zero dated every rider's ride at the session's end
// (audit 2026-09-09).
func (s *session) end(now time.Time) bool {
	if s.phase == "idle" || s.phase == "done" {
		return false
	}
	if s.phase == "running" {
		s.banked += now.Sub(s.startedAt)
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
				WorkoutName: s.workoutName, WorkoutJSON: s.workoutJSON, WorkoutHash: s.workoutHash, TotalSeconds: s.totalSeconds,
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
			// Banked as well as returned: this is not the only caller — a
			// rider's metrics or a presence poll can be the call that crosses,
			// and the tick that saves the ride reads the answer after it.
			s.phase = "done"
			elapsed = s.totalSeconds
			s.banked = time.Duration(s.totalSeconds) * time.Second
		}
	}
	if s.phase == "done" && s.totalSeconds > 0 && elapsed > s.totalSeconds {
		elapsed = s.totalSeconds
	}

	return protocol.SessionState{
		Phase: s.phase, Elapsed: elapsed,
		WorkoutName: s.workoutName, WorkoutJSON: s.workoutJSON, WorkoutHash: s.workoutHash, TotalSeconds: s.totalSeconds,
	}
}

// workoutHash names a definition on the wire (#1710): the tick carries it
// every second, and the JSON itself only reaches a socket that has not seen
// this hash. Not a security property — a name, so FNV is plenty.
func workoutHash(workoutJSON string) string {
	if workoutJSON == "" {
		return ""
	}
	h := fnv.New64a()
	_, _ = h.Write([]byte(workoutJSON))
	return strconv.FormatUint(h.Sum64(), 36)
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
		return s.end(now)
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

// TargetRPM is the rpm the room is turning during this block, or 0 when
// nothing is worth matching to (docs/SPEC.md "BPM matching", #270, #1431).
//
// A block that names a cadence band IS the answer — that band is the work
// (#66, "ERG holds the watts, the rpm is the workout"), so the midpoint wins
// over any guess from effort. Only 2 of the 28 library workouts carry one,
// which is why the effort fallback exists at all rather than the feature
// sitting idle on 26 of them. The effort tiers are the one invented thing
// here: riders self-select a higher cadence as intensity rises, and these
// are that curve at four points — SPEC numbers, marked as defaults.
func (m SessionMood) TargetRPM() int {
	switch {
	case m.CadenceLow > 0 && m.CadenceHigh > 0:
		return (m.CadenceLow + m.CadenceHigh) / 2
	case m.CadenceLow > 0:
		return m.CadenceLow
	case m.CadenceHigh > 0:
		return m.CadenceHigh
	case m.TargetPct <= 0:
		return 0 // nothing running, or absolute watts / a sprint: no preference
	case m.TargetPct <= 0.55:
		return 80 // recovery
	case m.TargetPct <= 0.75:
		return 85 // endurance and tempo
	case m.TargetPct <= 0.90:
		return 90 // sweet spot and threshold
	default:
		return 95 // VO₂ and above
	}
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

// sprintBlock is one sprint block of the timeline placed in wall-clock time.
// The second is the block's own place in the workout, which is what tells
// two sprints of the same ride apart; the window is that place resolved
// against the clock the room and its riders share.
type sprintBlock struct {
	second           int
	startsAt, endsAt time.Time
}

// sprintBlockAt is the sprint block under way, or the one starting within
// `lead` so the klaxon has its run-up (#2016). The block's own Seconds is
// the length — a workout says how long its sprint is, and Sprint Roulette
// already asks for 10–15 s (docs/SPEC.md).
//
// Anchored on the block, never on `now`: the tick that notices a block is up
// to a second late, so the window is computed from the timeline's origin
// (startedAt minus the time banked before the last pause) and lands on the
// same instant the client's own window does. Reads the timeline WITHOUT
// advancing it, like mood().
func (s *session) sprintBlockAt(now time.Time, lead time.Duration) (sprintBlock, bool) {
	if s.phase != "running" {
		return sprintBlock{}, false
	}
	// Wall-clock instant of workout second zero.
	origin := s.startedAt.Add(-s.banked)
	// Blocks are sequential, so the first match is the answer — and a sprint
	// still running outranks the lead of the sprint immediately after it.
	for _, seg := range s.segments {
		if seg.Kind != "sprint" || seg.Seconds <= 0 {
			continue
		}
		block := sprintBlock{
			second:   seg.Start,
			startsAt: origin.Add(time.Duration(seg.Start) * time.Second),
		}
		block.endsAt = block.startsAt.Add(time.Duration(seg.Seconds) * time.Second)
		if now.Before(block.startsAt.Add(-lead)) || !now.Before(block.endsAt) {
			continue
		}
		return block, true
	}
	return sprintBlock{}, false
}
