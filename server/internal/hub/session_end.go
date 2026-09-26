package hub

import (
	"context"
	"log/slog"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/safego"
)

// sessionEnd is what one tick hands off when the session has just closed:
// the ride record for the saver, the event for the XP keeper, the recap for
// its keeper. Snapshotted under the lock, persisted outside it.
type sessionEnd struct {
	records []RiderRecord
	meta    protocol.SessionState
	// When the timeline started, as the saver is told: one value, computed
	// once, so a later amendment finds the same ride (#1536).
	startedAt time.Time
	closed    *SessionClosed
	recap     *protocol.SessionRecap
	recaps    RecapKeeper
}

// abandonedSessionAfter is how long a paused session may sit with nobody in
// the channel before the hub ends it (docs/SPEC.md, #2813).
const abandonedSessionAfter = 10 * time.Minute

// endAbandonedSessionLocked ends a paused session nobody is left to resume
// (#2813). A paused timeline has no clock to run out, so without this its
// rides waited for the coach or an admin, and a deploy discarded them first.
// Ended here, the same tick's closeLocked saves them. Countdown and running
// are left alone: their own clocks close them. Called from the empty room's
// tick. Caller holds rm.mu.
func (rm *room) endAbandonedSessionLocked(now time.Time) {
	if rm.session.phase != "paused" || len(rm.voiceNow) > 0 {
		rm.abandonedSince = time.Time{}
		return
	}
	if rm.abandonedSince.IsZero() {
		rm.abandonedSince = now
	}
	if now.Sub(rm.abandonedSince) >= abandonedSessionAfter {
		rm.session.end(now)
		rm.abandonedSince = time.Time{}
	}
}

// closeLocked snapshots the session exactly once, on the tick its phase
// crosses to done — nil on every other tick. Caller holds rm.mu.
func (rm *room) closeLocked(state protocol.SessionState, now time.Time, saving bool) *sessionEnd {
	if state.Phase != "done" || rm.saved {
		return nil
	}
	rm.saved = true
	end := &sessionEnd{meta: state, startedAt: time.UnixMilli(now.UnixMilli() - int64(state.Elapsed)*1000)}
	if saving {
		// What a backfill after the close amends against (#1536): the same
		// start per rider, or the amendment finds no ride to grow — a replay
		// that lands after the close can reach back before a rider's first
		// sample, and FindRideAt keys on the start.
		rm.savedMeta, rm.savedStart = state, end.startedAt
		rm.savedStarts = make(map[string]time.Time, len(rm.seenOrder))
		for _, id := range rm.seenOrder {
			if record, ok := rm.record.byRider[id]; ok {
				samples := record.inOrder()
				start := riderStart(end.startedAt, samples)
				rm.savedStarts[id] = start
				end.records = append(end.records, RiderRecord{Rider: rm.seen[id], Samples: samples, StartedAt: start})
			}
		}
	}
	if rm.xp != nil {
		end.closed = rm.closedLocked(state, now)
	}
	// A session that ran leaves a recap; one that never started leaves
	// nothing, which is what an empty presence map means.
	if rm.recaps != nil && len(rm.present) > 0 {
		snapshot := rm.recapLocked(state, now)
		end.recap, end.recaps = &snapshot, rm.recaps
	}
	return end
}

// handOff persists a closed session outside the lock, like every other
// hand-off; nil is every tick on which nothing closed.
func (rm *room) handOff(log *slog.Logger, now func() time.Time, saver SessionSaver, end *sessionEnd) {
	if end == nil {
		return
	}
	if end.records != nil {
		// Fire and hand off: the tick loop never blocks on the database.
		// The saver owns timeouts and retries (#235); the goroutine exits
		// when its bounded retry policy returns — minutes at worst — and
		// the hub counts it so a shutdown waits for it.
		rm.detach(log, "session save "+rm.channel, func() {
			saver.SaveSession(context.Background(), rm.channel, end.meta.ID,
				end.meta.WorkoutName, end.meta.WorkoutJSON, end.startedAt, end.records)
		})
	}
	// The keeper returns at once (it queues its own I/O).
	if end.closed != nil {
		rm.xp.SessionClosed(*end.closed)
	}
	// On its own goroutine because this one reaches the database: the keeper
	// writes the row and posts it back for the next tick to carry (ADR-0034).
	if end.recap != nil {
		channel, session := rm.channel, end.meta.ID
		rm.detach(log, "session recap "+channel, func() { end.recaps.SaveRecap(channel, session, *end.recap) })
	}
}

// detach runs fn on its own goroutine like safego.Go, counted on the hub's
// hand-offs while it runs so Drain can wait for it.
func (rm *room) detach(log *slog.Logger, where string, fn func()) {
	if rm.pending == nil {
		safego.Go(log, where, fn)
		return
	}
	rm.pending.Add(1)
	safego.Go(log, where, func() {
		defer rm.pending.Done()
		fn()
	})
}
