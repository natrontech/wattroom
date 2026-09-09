// What a room does with a ride: metrics in, the backfill after a drop,
// cheers and the board, the mood, and the coach's control of the session and
// the game. Membership and the room struct itself stay in room.go.
package hub

import (
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// validMetrics bounds WS input before it touches room state.
func validMetrics(m protocol.RiderMetrics) bool {
	return m.Watts >= 0 && m.Watts <= 3000 &&
		m.HR >= 0 && m.HR <= 250 &&
		m.Cadence >= 0 && m.Cadence <= 250
}

func (rm *room) setMetrics(c *client, m protocol.RiderMetrics) {
	rider := c.rider
	now := rm.now()
	rm.mu.Lock()
	defer rm.mu.Unlock()
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
func (rm *room) backfill(rider protocol.Rider, samples []protocol.RiderMetrics) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if _, known := rm.seen[rider.ID]; !known {
		rm.seenOrder = append(rm.seenOrder, rider.ID)
	}
	rm.seen[rider.ID] = rider
	for _, m := range samples {
		if validMetrics(m) {
			// Backfilled samples have no known timeline second — recorded, not
			// live-scored; the save-time score is the authoritative one. They
			// are also the one place a seq goes backwards on purpose, so they
			// stay on the stream that sent them (#522).
			rm.record.replay(rider.ID, m)
		}
	}
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

// fire queues one soundboard press for the next tick. Bounded like cheers:
// the per-rider limit already makes a flood rare, and the bound is what makes
// "rare" not matter.
func (rm *room) fire(b protocol.Board) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
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

// mood is what this room's timeline is asking for right now (#270), for the
// autoplay read that happens outside the lock. Taken under the lock and
// returned by value: the caller must not hold a pointer into live state.
func (rm *room) mood(now time.Time) SessionMood {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	return rm.session.mood(now)
}

// startGame begins a mode; refused while another runs (end it first).
func (rm *room) startGame(mode string, now time.Time) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if rm.game != nil && !rm.game.done() {
		return false
	}
	next := newGameMode(mode, now)
	if next == nil {
		return false
	}
	rm.game = next
	return true
}

func (rm *room) endGame() {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.game = nil
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

func (rm *room) control(c protocol.Control, riderID string, now time.Time) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	// A new start is a new ride: the record must not blend two sessions.
	if c.Action == "start" {
		rm.record.reset()
		rm.seen = make(map[string]protocol.Rider)
		rm.seenOrder = nil
		rm.saved = false
		rm.voiceMs = make(map[string]int64)
		// A new session is a new recap: the last one's presence must not
		// leak into it (ADR-0034).
		rm.present = make(map[string]*span)
		rm.presentSince = time.Time{}
		rm.startedBy = riderID
	}
	return rm.session.apply(c, now)
}
