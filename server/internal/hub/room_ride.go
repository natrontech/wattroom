// What a room does with a ride: metrics in, the backfill after a drop,
// cheers and the board, the mood, and the coach's control of the session and
// the game. Membership and the room struct itself stay in room.go.
package hub

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// validMetrics bounds WS input before it touches room state.
func validMetrics(m protocol.RiderMetrics) bool {
	return m.Watts >= 0 && m.Watts <= 3000 &&
		m.HR >= 0 && m.HR <= 250 &&
		m.Cadence >= 0 && m.Cadence <= 250
}

func (rm *room) setMetrics(c *client, m protocol.RiderMetrics) {
	now := rm.now()
	rm.mu.Lock()
	defer rm.mu.Unlock()
	// Under the lock (#2229): `SetRole` writes `c.rider.Role` on this same
	// client from an HTTP handler's goroutine, under this same lock, whenever
	// a rider is promoted, demoted or handed the room. Read outside it, this
	// is a race — and the copy is what lands in `rm.seen`, which is what the
	// saved ride and every podium are built from.
	rider := c.rider
	// One stream per rider (#610). Two paired screens do not merely overwrite
	// each other here — their per-session `seq` counters interleave, which
	// reads to the accumulator as a fresh stream and lands BOTH sets of
	// samples in the one ride record. So the screen holding the trainer claim
	// is the only one that speaks; a rider with no claim at all is unaffected.
	if !rm.ownsTrainerLocked(c) {
		return
	}
	rm.metrics[rider.ID] = m
	rm.lastMetric[rider.ID] = now
	if m.Watts > 0 {
		rm.lastWatts[rider.ID] = now
	}
	// The channel sees every rider's numbers; the session keeps only its
	// own riders' (ADR-0059). A spectator — a free rider beside it, or
	// someone who never joined — is on no podium and saves no session ride.
	if !rm.session.rides(rider.ID) {
		return
	}
	if _, known := rm.seen[rider.ID]; !known {
		rm.seenOrder = append(rm.seenOrder, rider.ID)
	}
	rm.seen[rider.ID] = rider
	// The live sample is also part of the ride record; a later resend of the
	// same seq dedupes against it, and it scores live at the timeline second
	// it arrived on (#27).
	if rm.session.phase == "running" {
		state := rm.session.state(now)
		rm.record.add(rider.ID, m, rm.session.segments, float64(rider.FtpWatts), state.Elapsed)
		rm.sprint.collect(rider.ID, m.Watts, now)
	}
}

// backfill lands in the record whatever the phase: after a server restart the
// room comes back idle, and dropping the replay then is exactly the data loss
// this exists to prevent. The record is bounded per rider and reset on the
// next start, so out-of-session samples cost nothing and hurt nobody.
func (rm *room) backfill(c *client, samples []protocol.RiderMetrics, log *slog.Logger, saver SessionSaver) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rider := c.rider // under the lock, as in setMetrics (#2229)
	// The claim gates the replay as it gates live metrics: a screen that
	// lost the trainer to another of the rider's tabs and then reconnected
	// used to land its buffer in the record beside the holder's (audit
	// 2026-09-09) — the interleaving setMetrics exists to prevent.
	if !rm.ownsTrainerLocked(c) {
		return
	}
	// A spectator's replay is theirs, as their live samples are (ADR-0059).
	// With no session open — a server that restarted idle — it lands as it
	// always did, since there is nobody's list to check it against.
	if rm.session.open() && !rm.session.rides(rider.ID) {
		return
	}
	if _, known := rm.seen[rider.ID]; !known {
		rm.seenOrder = append(rm.seenOrder, rider.ID)
	}
	rm.seen[rider.ID] = rider
	// A session's record is kept by the timeline second (#2814): a replayed
	// sample goes where its clock says, and one the hub cannot place — no
	// clock, or a second the timeline never reached — is left out, as the
	// live path leaves out a second outside the running timeline. With no
	// session behind the record (a server that came back idle) there is no
	// timeline to place it on, and it lands as it always did.
	reached, placed := rm.replayReachLocked()
	kept := 0
	for _, m := range samples {
		if !validMetrics(m) || placed && (m.Clock <= 0 || m.Clock > reached) {
			continue
		}
		// Not live-scored: the save-time score is the authoritative one. The
		// one place a seq goes backwards on purpose, so it stays on the
		// stream that sent it (#522).
		rm.record.replay(rider.ID, m)
		kept++
	}
	// One row a second: the buffer's length is the silence it covers, and
	// an elimination mode forgives a silence the rider pedalled through
	// (#1576, docs/SPEC.md's disconnect grace).
	if p, ok := rm.game.(pedalled); ok && kept > 0 {
		p.keptPedalling(rider.ID, kept, rm.now())
	}
	// After the close the record has been snapshotted and saved, and what
	// lands here was read by nothing (#1536): a socket that dropped at
	// minute 55 and came back after the timeline ended lost its tail. The
	// rider's whole record goes to the saver again, which grows the saved
	// ride from it — outside the lock, like every hand-off.
	if kept > 0 && rm.saved && saver != nil {
		if record, ok := rm.record.byRider[rider.ID]; ok {
			whole := RiderRecord{Rider: rider, Samples: record.inOrder()}
			// The start the close saved, however far back this replay reaches;
			// a rider with none had no ride saved, and the saver finds nothing.
			var saved bool
			if whole.StartedAt, saved = rm.savedStarts[rider.ID]; !saved {
				whole.StartedAt = riderStart(rm.savedStart, whole.Samples)
			}
			meta, start := rm.savedMeta, rm.savedStart
			rm.detach(log, "ride amend "+rm.channel, func() {
				saver.AmendRide(context.Background(), rm.channel, meta.ID, meta.WorkoutName, meta.WorkoutJSON, start, whole)
			})
		}
	}
}

// replayReachLocked is the last timeline second a replayed sample may carry,
// and whether the record belongs to a session at all: the one running, or the
// one that closed and may still be amended (#1536). Caller holds rm.mu.
func (rm *room) replayReachLocked() (int, bool) {
	switch {
	case rm.session.open():
		return rm.session.state(rm.now()).Elapsed, true
	case rm.saved:
		return rm.savedMeta.Elapsed, true
	}
	return 0, false
}

// cheer queues one reaction for the next tick; bounded so a hostile burst
// cannot grow the payload (the per-client rate limit already makes this rare).
func (rm *room) cheer(c protocol.Cheer) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if len(rm.cheers) < 32 {
		rm.cheers = append(rm.cheers, c)
	}
}

// firing is one clip a rider still has going, and when it started (#1681).
type firing struct {
	clipID string
	at     time.Time
}

// soundingCeiling is how long the room assumes a fire is still sounding.
// SPEC caps a clip at 60 s, so nothing can outlive this — and nothing needs
// to be shorter: the listener fetches the clip and stops at its real end, so
// over-reporting here costs a joiner one metadata fetch that plays nothing.
const soundingCeiling = 60 * time.Second

// fire queues one soundboard press for the next tick. Bounded like cheers:
// the per-rider limit already makes a flood rare, and the bound is what makes
// "rare" not matter.
//
// It also remembers the press. The tick's batch is drained every second, but
// the airhorn is not over in a second: a rider who joins halfway through one
// has no fire to read, and used to arrive into a room where somebody was
// visibly playing nothing.
func (rm *room) fire(b protocol.Board) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if b.ClipID == "" {
		delete(rm.sounding, b.FromID)
	} else {
		rm.sounding[b.FromID] = firing{clipID: b.ClipID, at: rm.now()}
	}
	// A stop after a stop, with nothing of the rider's fired in between, says
	// nothing new. Dropping it is what lets a stop skip the cooldown without
	// letting one rider fill the tick with them.
	if b.ClipID == "" {
		for i := len(rm.board) - 1; i >= 0; i-- {
			if rm.board[i].FromID != b.FromID {
				continue
			}
			if rm.board[i].ClipID == "" {
				return
			}
			break
		}
	}
	if len(rm.board) < 32 {
		rm.board = append(rm.board, b)
	}
}

// soundingLocked is what one rider still has playing, for the roster: the clip
// and how far into it the room already is. Empty once nothing is, or once the
// ceiling has passed — the entry is dropped then, so a room that ran for hours
// holds one per rider who fired, not one per fire.
func (rm *room) soundingLocked(riderID string, now time.Time) (string, int64) {
	live, ok := rm.sounding[riderID]
	if !ok {
		return "", 0
	}
	since := now.Sub(live.at)
	if since >= soundingCeiling {
		delete(rm.sounding, riderID)
		return "", 0
	}
	if since < 0 {
		since = 0
	}
	return live.clipID, since.Milliseconds()
}

// mood is what this room's timeline is asking for right now (#270), for the
// autoplay read that happens outside the lock. Taken under the lock and
// returned by value: the caller must not hold a pointer into live state.
func (rm *room) mood(now time.Time) SessionMood {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	return rm.session.mood(now)
}

func (rm *room) armIfRunning(now time.Time) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if rm.session.phase != "running" {
		return false
	}
	rm.armSprint(now)
	return true
}

// control runs one control message for rider (#2438, docs/SPEC.md's roles
// matrix): anyone who may enter the channel opens a session with a pick when
// none is open, and is its coach; the coach drives it and may hand it off;
// the crew's owner and admins may end it, which is the one lever they hold
// over a session somebody else is coaching. Returns errors.md's code and a
// message, or two empty strings when it ran.
//
// Checked and applied under one lock, so two riders picking at the same
// moment cannot both open the channel's one session.
func (rm *room) control(c protocol.Control, rider protocol.Rider, now time.Time) (code, message string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if code, message := rm.refusalLocked(c.Action, rider); code != "" {
		return code, message
	}
	if c.Action == "handoff" {
		return rm.handOffLocked(rider.ID, c.Rider, now)
	}
	if c.Action == "join" || c.Action == "leave" {
		rm.session.join(rider.ID, c.Action == "join")
		return "", ""
	}
	if c.Action == "pick" && !rm.session.open() {
		rm.session.begin(uuid.NewString(), rider.ID, rider.Name)
	}
	// A countdown stopped before it started (#2605) says so on the timeline,
	// named while the session still carries its workout: its "starting" line
	// would otherwise stand there with nothing after it.
	stopping := c.Action == "end" && rm.session.state(now).Phase == "countdown"
	stopped := rm.session.workoutName
	// The session answers first: a start the phase refuses — a stale coach
	// tab, two coaches racing the countdown — used to wipe the running
	// ride's record and roster before hearing no (audit 2026-09-09).
	if !rm.session.apply(c, now) {
		return "invalid_request", "That does not work right now — the session is in another phase."
	}
	if stopping {
		rm.events.add(sessionLine("stopped", "", stopped, time.Time{}, now), now)
	}
	// A new start is a new ride.
	if c.Action == "start" {
		rm.resetRunLocked(rider.ID)
	}
	// Ending a game's session ends its game (#2597) — the coach's End, or a
	// crew admin's over a game somebody left running.
	if c.Action == "end" && rm.session.game != "" {
		rm.stopGameLocked(now)
	}
	return "", ""
}

// refusalLocked is who may do what to the channel's session (#2438). Caller
// holds rm.mu.
func (rm *room) refusalLocked(action string, rider protocol.Rider) (code, message string) {
	s := rm.session
	coaching := s.coachName
	if coaching == "" {
		coaching = "Someone"
	}
	switch action {
	case "pick", "start":
		// One session per voice channel: the refusal names who has it, so
		// the rider knows whom to ask rather than only that they cannot.
		if s.open() && s.coach != rider.ID {
			return "conflict", coaching + " is coaching a session in this channel — one runs here at a time."
		}
		// The close snapshots the session on the tick after it ends; a pick
		// in between would replace it before its rides were handed over.
		if action == "pick" && s.phase == "done" && !rm.saved {
			return "conflict", "The last session is still being saved — try again in a second."
		}
	case "join", "leave":
		// Anyone in the channel, the coach included: a coach may run the
		// timeline from the side (ADR-0059).
		if !s.open() {
			return "invalid_request", "No session is running in this channel."
		}
	case "end":
		if s.open() && s.coach != rider.ID && !rider.Administers() {
			return "forbidden", "Only the session's coach, or the crew's owner or an admin, can end it."
		}
	default: // pause, resume, handoff, and the game and sprint buttons
		if s.open() && s.coach != rider.ID {
			return "forbidden", coaching + " is coaching this session — only the coach can do that."
		}
		// A game opens a session now (#2597), so a game with none open is
		// only a finished one's podium, lingering — anyone may clear it.
		if !s.open() && (action == "pause" || action == "resume" || action == "handoff") {
			return "invalid_request", "No session is running in this channel."
		}
		// The same guard a pick has: a game opening a session in between
		// would replace the last one before its rides were handed over.
		if action == "game" && s.phase == "done" && !rm.saved {
			return "conflict", "The last session is still being saved — try again in a second."
		}
		// A game keeps its own clock and runs its own sprints.
		if s.open() && s.game != "" && (action == "pause" || action == "resume") {
			return "invalid_request", "A game keeps its own clock — it does not pause."
		}
		if s.open() && s.game != "" && action == "sprint" {
			return "invalid_request", "A game runs its own sprints."
		}
	}
	return "", ""
}

// handOffLocked gives the session to someone riding in it (#2438; SPEC's
// roles: "until they hand it to someone in the session"): a light, live
// action, never a crew-role change. Only to a rider who joined (#2829) —
// joining is explicit (ADR-0059), and a hand-off used to draft whoever it
// named onto the timeline, their trainer with it. Caller holds rm.mu and has
// checked that from is the coach.
func (rm *room) handOffLocked(from, to string, now time.Time) (code, message string) {
	name := rm.nameOfLocked(to)
	if to == from || name == "" || !rm.session.rides(to) {
		return "invalid_request", "Hand the session to someone riding in it."
	}
	rm.events.add(handOffLine("handedOff", rm.session.coachName, name, now), now)
	rm.session.coach, rm.session.coachName = to, name
	return "", ""
}

// passSessionLocked hands on a session whose coach has been gone past the
// grace window (#2636, decided 2026-09-24): to whoever has ridden in it
// longest — the first in `seenOrder` who is still here and still pedalling.
// Left with an absent coach, nobody could pause, resume or hand it on, and a
// paused one would hold the channel for good. With nobody riding it stays
// where it is, and a crew admin's End is the way out (#2598). Caller holds
// rm.mu.
func (rm *room) passSessionLocked(now time.Time) {
	for _, id := range rm.seenOrder {
		at, pedalling := rm.lastWatts[id]
		// Still riding it: one who pressed Leave the ride is a free rider
		// now, however long they rode it first (ADR-0059, #2829).
		if id == rm.session.coach || !rm.session.rides(id) || !pedalling || now.Sub(at) > ridingWindow {
			continue
		}
		name := rm.nameOfLocked(id)
		if name == "" {
			continue // rode, and has left too
		}
		rm.events.add(handOffLine("passedOn", rm.session.coachName, name, now), now)
		rm.session.coach, rm.session.coachName = id, name
		return
	}
}
