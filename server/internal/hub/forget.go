// When the hub lets go of a room: how long an empty one keeps its clock, the
// claim that keeps the sweep off a room a socket is arriving at, and the
// delete that ends the goroutine. Nothing here is a new goroutine — the room's
// own tick notices it has been empty long enough and returns.
package hub

import (
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// roomIdleTTL is how long a room may sit empty before the hub forgets it —
// docs/SPEC.md, "A room nobody is in is forgotten after 2 h", which also says
// what is lost when it fires. The number is the product's, not this file's.
//
// Until #2297, `h.rooms[slug]` was deleted only by CloseRoom, and CloseRoom
// fires only when the durable room row is deleted (#618): every slug anyone
// had WS-joined since process start kept a tick goroutine, a jukebox queue, a
// chat buffer, an event log, a session, a roster and per-rider sample
// accumulators until the process was replaced.
const roomIdleTTL = 2 * time.Hour

// idleForLocked is how long the room has been forgettable, and zero whenever
// it is not — which is also what restarts the window. Called from the tick's
// empty branch, so "no sockets" is the caller's half; what this adds is:
//
//   - Nobody in the voice channel. h.voice is keyed by slug, fed by LiveKit's
//     webhooks independently of the sockets and outliving them (#149), so a
//     room with voice participants and no sockets is not empty — somebody is
//     in it talking. rm.voiceNow is the hub's own map mirrored into the room;
//     forgetRoom re-reads the original before it deletes anything.
//   - A session that is idle or done. A countdown, a running or a PAUSED
//     timeline still holds samples nobody has saved, and this room's clock is
//     the only thing that will close and save them (closeLocked) — forgetting
//     the room would discard the ride. A running timeline ends itself when the
//     workout runs out; a paused one keeps the room until somebody resumes or
//     ends it.
//
// The deck is deliberately not a condition. The server holds an anchor and no
// duration (docs/SPEC.md, sync tolerances): only a client reports `ended`, so
// a deck left mid-track by the last rider to leave never idles again and would
// pin its room for the life of the process — which is the leak this is here to
// close. With no sockets there is no player: the anchor is a stale timestamp
// rather than something playing.
//
// Caller holds rm.mu.
func (rm *room) idleForLocked(state protocol.SessionState, now time.Time) time.Duration {
	if len(rm.voiceNow) > 0 || (state.Phase != "idle" && state.Phase != "done") {
		rm.emptySince = time.Time{}
		return 0
	}
	if rm.emptySince.IsZero() {
		rm.emptySince = now
	}
	return now.Sub(rm.emptySince)
}

// holdRoom is HandleWS's way in: room()'s lookup-or-create, plus a claim that
// keeps the sweep off this slug while the socket is arriving. Taken BEFORE the
// lookup and released only after the client has left, so the claim strictly
// encloses the socket's membership of the room.
//
// Without it the sweep has a window: a rider handed the room pointer by room()
// has not joined yet, so the tick still sees an empty room, and forgetting it
// there leaves that rider in a room with no clock and no entry in the hub —
// sockets open, timer never moving, which is exactly the failure #751 closed
// from the other end.
func (h *Hub) holdRoom(slug string) *room {
	h.mu.Lock()
	h.holds[slug]++
	h.mu.Unlock()
	return h.room(slug)
}

// releaseRoom drops one claim, deleting the key on the last — the map is
// bounded by rooms being joined right now, not by rooms ever joined.
func (h *Hub) releaseRoom(slug string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	releaseCount(h.holds, slug)
}

// forgetRoom drops a room the hub has nothing left to do for, reporting
// whether it did. The room's own tick calls it once idleForLocked passes
// roomIdleTTL and returns when it says yes: the goroutine that decides is the
// one that ends, and its exit condition is this answer.
//
// The room leaves h.rooms under the same lock room() takes, so nobody can be
// handed it afterwards — only HandleWS brings a room back, through holdRoom.
// It refuses on every claim the tick cannot see for itself: a socket arriving,
// a voice participant that turned up since the tick's copy, and a slug that
// has stopped being this room at all (a CloseRoom, then a re-create). Its stop
// channel stays open on purpose — the tick is about to return on its own, and
// a later CloseRoom of the slug must reach whatever room holds it then.
func (h *Hub) forgetRoom(rm *room) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rooms[rm.slug] != rm || h.holds[rm.slug] > 0 || len(h.voice[rm.slug]) > 0 {
		return false
	}
	delete(h.rooms, rm.slug)
	return true
}
