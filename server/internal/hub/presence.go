// What the rest of the server may ask about live rooms: who is in one, how
// many are online, and where a given rider is standing. Read-only views
// over hub state, all of them taken under the hub's lock.
package hub

import (
	"sort"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// occupied is the room at slug if anyone is connected to it — never creating
// one, unlike room(): an HTTP post must not start a ticker for nobody.
func (h *Hub) occupied(slug string) *room {
	h.mu.Lock()
	rm, ok := h.rooms[slug]
	h.mu.Unlock()
	if !ok {
		return nil
	}
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if len(rm.clients) == 0 {
		return nil
	}
	return rm
}

func (h *Hub) Presence(slug string) protocol.RoomPresence {
	h.mu.Lock()
	rm, ok := h.rooms[slug]
	p := protocol.RoomPresence{Phase: "idle", Voice: make([]string, 0, 4)}
	// Fold by rider, not by connection: two tabs are one person on the radar,
	// and a camera live in either of them is that person on camera (#293).
	names := make(map[string]string, len(h.voice[slug]))
	cameras := make(map[string]bool, len(h.voice[slug]))
	for _, entry := range h.voice[slug] {
		names[entry.rider] = entry.name
		cameras[entry.rider] = cameras[entry.rider] || entry.camera
	}
	for rider, name := range names {
		p.Voice = append(p.Voice, name)
		if cameras[rider] {
			p.Cameras = append(p.Cameras, name)
		}
	}
	h.mu.Unlock()
	sort.Strings(p.Voice)
	sort.Strings(p.Cameras)
	if !ok {
		return p
	}
	now := h.now()
	rm.mu.Lock()
	defer rm.mu.Unlock()
	seen := make(map[string]struct{}, len(rm.clients))
	present := make([]protocol.Rider, 0, len(rm.clients))
	for c := range rm.clients {
		if _, dup := seen[c.rider.ID]; dup {
			continue
		}
		seen[c.rider.ID] = struct{}{}
		present = append(present, c.rider)
	}
	sort.Slice(present, func(i, j int) bool { return present[i].Name < present[j].Name })
	for _, rider := range present {
		p.Riders = append(p.Riders, rider.Name)
		p.RiderIDs = append(p.RiderIDs, rider.ID)
	}
	p.Connected = len(seen)
	p.Riding, p.RidingIDs = rm.ridingLocked(now)
	state := rm.session.state(now)
	p.Phase = state.Phase
	if state.Phase == "countdown" || state.Phase == "running" || state.Phase == "paused" {
		// The late-join radar: enough to render "Openers · 32 min in".
		p.WorkoutName = state.WorkoutName
		p.ElapsedSec = state.Elapsed
	}
	return p
}

// OnlineCount is WhereIs without the who: how many distinct riders hold a
// lobby socket right now. The landing page's one live number — a count only,
// no identities, so it stays safe to serve to a signed-out visitor.
func (h *Hub) OnlineCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	seen := make(map[string]struct{}, len(h.lobby))
	for _, id := range h.lobby {
		seen[id] = struct{}{}
	}
	return len(seen)
}

// WhereIs answers the friends panel (ADR-0012): who is online, and which room
// each of these users is connected to right now — live state only, persisted
// nowhere. Present in the map = online (the lobby socket, #251 — Slack's green
// dot); a non-empty value names the room. Lock, copy the room refs, unlock;
// then per-room lock to scan clients.
func (h *Hub) WhereIs(userIDs []string) map[string]string {
	wanted := make(map[string]struct{}, len(userIDs))
	for _, id := range userIDs {
		wanted[id] = struct{}{}
	}
	out := make(map[string]string, len(userIDs))
	h.mu.Lock()
	rooms := make(map[string]*room, len(h.rooms))
	for slug, rm := range h.rooms {
		rooms[slug] = rm
	}
	for _, id := range h.lobby {
		if _, ok := wanted[id]; ok {
			out[id] = ""
		}
	}
	h.mu.Unlock()

	for slug, rm := range rooms {
		rm.mu.Lock()
		for c := range rm.clients {
			if _, ok := wanted[c.rider.ID]; ok {
				out[c.rider.ID] = slug
			}
		}
		rm.mu.Unlock()
	}
	return out
}
