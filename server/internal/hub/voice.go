// Voice and camera presence. LiveKit is the source of truth and tells the
// server who is connected (webhooks and the periodic sync); the room only
// mirrors that into the tick and the voice-time accrual. Nothing here
// carries audio — the media never touches this process (ADR-0010).
package hub

import (
	"sort"
	"time"

	"github.com/natrontech/wattroom/server/internal/av"
)

// voiceEntry remembers when the join was reported, so a reconcile sweep
// cannot prune a rider who joined after its snapshot was taken — and whether
// their camera is live (#251, track_published).
type voiceEntry struct {
	// One entry per LiveKit connection, keyed by identity — a rider with two
	// tabs open holds two (#293), so a leave from one must not blank the
	// other. `rider` is who they all belong to.
	rider    string
	name     string
	joinedAt time.Time
	camera   bool
}

// VoiceJoined/VoiceLeft feed the sidebar radar (#149) from LiveKit's
// webhooks — who is in the voice channel, before you enter the room. Keyed
// by identity so a double event cannot duplicate a name; the map is
// hub-owned like every other piece of live state.
func (h *Hub) VoiceJoined(slug, identity, name string) {
	h.mu.Lock()
	if h.voice[slug] == nil {
		h.voice[slug] = make(map[string]voiceEntry, 4)
	}
	// Merge, don't overwrite: a camera flag set by an early track_published
	// must survive the participant_joined that follows it.
	entry := h.voice[slug][identity]
	entry.rider = av.RiderID(identity)
	entry.name = name
	if entry.joinedAt.IsZero() {
		entry.joinedAt = h.now()
	}
	h.voice[slug][identity] = entry
	after := h.voiceChangedLocked(slug)
	h.mu.Unlock()
	after()
}

func (h *Hub) VoiceLeft(slug, identity string) {
	h.mu.Lock()
	delete(h.voice[slug], identity)
	if len(h.voice[slug]) == 0 {
		delete(h.voice, slug)
	}
	after := h.voiceChangedLocked(slug)
	h.mu.Unlock()
	after()
}

// voiceRidersLocked folds a room's voice entries to rider ids — two tabs are
// one rider. The caller holds h.mu.
func (h *Hub) voiceRidersLocked(slug string) map[string]struct{} {
	riders := make(map[string]struct{}, len(h.voice[slug]))
	for _, entry := range h.voice[slug] {
		riders[entry.rider] = struct{}{}
	}
	return riders
}

// voiceChangedLocked pings the lobby and hands back what to do once h.mu is
// released: tell the live room who is in voice now (#467). The room lock is
// never taken under the hub lock — same discipline as Presence.
func (h *Hub) voiceChangedLocked(slug string) func() {
	h.pingLobbyLocked()
	rm, live := h.rooms[slug]
	if !live {
		return func() {}
	}
	riders := h.voiceRidersLocked(slug)
	return func() { rm.setVoice(riders) }
}

// VoiceRiderIDs is every rider in any voice channel right now, once each —
// the lounge-XP ticker's input (#467). Lock, copy, unlock.
func (h *Hub) VoiceRiderIDs() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	seen := make(map[string]struct{})
	for _, entries := range h.voice {
		for _, entry := range entries {
			seen[entry.rider] = struct{}{}
		}
	}
	ids := make([]string, 0, len(seen))
	for id := range seen {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// VoiceCamera flips one participant's camera flag (#251) — track_published /
// track_unpublished. Upserts: the track event can beat the join webhook, and
// a live camera implies presence in the voice room anyway.
func (h *Hub) VoiceCamera(slug, identity, name string, on bool) {
	h.mu.Lock()
	entry, ok := h.voice[slug][identity]
	if !ok && !on {
		h.mu.Unlock()
		return
	}
	if !ok {
		entry = voiceEntry{rider: av.RiderID(identity), name: name, joinedAt: h.now()}
	}
	entry.camera = on
	if h.voice[slug] == nil {
		h.voice[slug] = make(map[string]voiceEntry, 4)
	}
	h.voice[slug][identity] = entry
	after := h.voiceChangedLocked(slug)
	h.mu.Unlock()
	after()
}

// VoiceRoomClosed clears a whole room's voice state (room_finished).
func (h *Hub) VoiceRoomClosed(slug string) {
	h.mu.Lock()
	delete(h.voice, slug)
	after := h.voiceChangedLocked(slug)
	h.mu.Unlock()
	after()
}

// VoiceRooms lists the rooms the radar currently shows anyone in — the
// reconciler's work list. Lock, copy, unlock.
func (h *Hub) VoiceRooms() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	slugs := make([]string, 0, len(h.voice))
	for slug := range h.voice {
		slugs = append(slugs, slug)
	}
	return slugs
}

// VoiceSync applies LiveKit's actual participant list (#234): a hard-crashed
// LiveKit never sends participant_left, so identities it no longer knows are
// pruned — unless they joined after the snapshot at `since` was requested —
// and anyone a lost webhook missed is added.
func (h *Hub) VoiceSync(slug string, present map[string]string, since time.Time) {
	h.mu.Lock()
	after := func() {}
	defer func() { h.mu.Unlock(); after() }()
	changed := false
	for identity, entry := range h.voice[slug] {
		if _, ok := present[identity]; !ok && entry.joinedAt.Before(since) {
			delete(h.voice[slug], identity)
			changed = true
		}
	}
	for identity, name := range present {
		if _, ok := h.voice[slug][identity]; ok {
			continue
		}
		if h.voice[slug] == nil {
			h.voice[slug] = make(map[string]voiceEntry, len(present))
		}
		h.voice[slug][identity] = voiceEntry{rider: av.RiderID(identity), name: name, joinedAt: h.now()}
		changed = true
	}
	if len(h.voice[slug]) == 0 {
		delete(h.voice, slug)
	}
	if changed {
		after = h.voiceChangedLocked(slug)
	}
}

// setVoice replaces who the hub says is in the channel (#467).
func (rm *room) setVoice(riders map[string]struct{}) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.voiceNow = riders
}

// voiceIDsLocked is who the hub says is in the channel, in the shape the tick
// carries it. Sorted so a tick does not churn on map order. Caller holds rm.mu.
func (rm *room) voiceIDsLocked() []string {
	if len(rm.voiceNow) == 0 {
		return nil
	}
	ids := make([]string, 0, len(rm.voiceNow))
	for id := range rm.voiceNow {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// accrueVoiceLocked adds one tick's worth of voice time to everyone in the
// channel while the timeline runs (#467). Caller holds rm.mu.
func (rm *room) accrueVoiceLocked(phase string, dt time.Duration) {
	if phase != "running" {
		return
	}
	for id := range rm.voiceNow {
		rm.voiceMs[id] += dt.Milliseconds()
	}
}
