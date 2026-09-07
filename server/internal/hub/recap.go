// What a session leaves behind (ADR-0034): who was in the room while it ran,
// and for how long. Presence and time only — the hub already knows both, and
// nothing here reaches for a metric.
package hub

import (
	"sort"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// RecapKeeper persists a finished session's recap and hands the stored row
// back to the room. Defined here, where it is consumed; the recap service
// implements it. Nil means "no database" and a session simply leaves nothing,
// exactly as before ADR-0034. Called from a goroutine, outside every lock:
// the implementation owns its own timeouts.
type RecapKeeper interface {
	SaveRecap(slug string, recap protocol.SessionRecap)
}

// SetRecapKeeper wires the store that makes a session durable.
func (h *Hub) SetRecapKeeper(k RecapKeeper) { h.recaps = k }

// PostRecap hands the stored recap to whoever is standing in the room, so the
// card appears the moment it is written rather than on their next join. A room
// nobody holds open gets nothing — its riders read the backlog when they
// arrive, which is where the row already is.
func (h *Hub) PostRecap(slug string, recap protocol.SessionRecap) {
	if rm := h.occupied(slug); rm != nil {
		rm.recapWritten(recap)
	}
}

func (rm *room) recapWritten(recap protocol.SessionRecap) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.recap = &recap
}

// span is one rider's presence across a session: when it first saw them and
// when it last did.
//
// One interval per rider, not a list of them. A rider who drops for ten
// seconds and comes back is one bar on the card, and a socket that flaps in a
// garage must not draw a comb — the same reason presenceGrace exists for the
// live lines. What the card says is "Kim was here from a third of the way in",
// and that survives every flap.
type span struct {
	name string
	from time.Time
	to   time.Time
}

// sawLocked marks everyone present right now as seen, once per tick while the
// session runs. Sampling beats hooking join and leave: it needs no grace
// window, folds a rider's several screens by itself, and cannot drift out of
// step with the roster the room is drawing. Caller holds rm.mu.
func (rm *room) sawLocked(now time.Time) {
	for c := range rm.clients {
		if s, ok := rm.present[c.rider.ID]; ok {
			s.name, s.to = c.rider.Name, now
			continue
		}
		rm.present[c.rider.ID] = &span{name: c.rider.Name, from: now, to: now}
	}
}

// recapLocked is the session as the card will draw it, ordered by when each
// rider arrived — which is the order the room filled up in, and the order the
// bars read down the card. Ties break on name so a map's iteration order
// never reaches a rider's screen. Caller holds rm.mu.
func (rm *room) recapLocked(state protocol.SessionState, now time.Time) protocol.SessionRecap {
	out := protocol.SessionRecap{
		Workout: state.WorkoutName,
		// The timeline's own clock: elapsed excludes pauses, so this is when
		// the riding started rather than when the countdown did.
		StartedAt: now.UnixMilli() - int64(state.Elapsed)*1000,
		EndedAt:   now.UnixMilli(),
	}
	for id, s := range rm.present {
		out.Riders = append(out.Riders, protocol.SessionRecapRider{
			ID: id, Rider: s.name,
			From: s.from.UnixMilli(), To: s.to.UnixMilli(),
			// The same threshold the saver keeps a ride at: a filled pip
			// means there is a ride row to match it.
			Rode: rm.record.count(id) >= MinRideSamples,
		})
	}
	sort.Slice(out.Riders, func(i, j int) bool {
		if out.Riders[i].From != out.Riders[j].From {
			return out.Riders[i].From < out.Riders[j].From
		}
		return out.Riders[i].Rider < out.Riders[j].Rider
	})
	return out
}
