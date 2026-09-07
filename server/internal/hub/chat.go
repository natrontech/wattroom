// Chat fan-out. The chat store owns the messages; the hub only relays what it
// is told to the room's clients, so a rider standing in the room sees a line,
// an edit or a reaction without re-fetching.
package hub

import "github.com/natrontech/wattroom/server/internal/protocol"

// PostChat hands a line that arrived over HTTP (#468) to whoever is
// connected: it rides the next tick exactly like a socket line. The hub
// lock finds the room, the room lock queues it — never both at once. A room
// nobody holds open gets nothing: its riders will read the backlog when
// they arrive, and a line parked in an empty room's queue would land twice.
func (h *Hub) PostChat(slug string, line protocol.ChatLine) {
	if rm := h.occupied(slug); rm != nil {
		rm.chatLine(line)
	}
	// Everyone's unread count for this room just changed (#568). A room
	// nobody holds open never ticks, so this is the only ping it will get;
	// when the room IS live the tick pings too and the lobby coalesces the
	// pair — one ping is enough either way.
	h.PresenceChanged()
}

// PostReaction is PostChat for a reaction toggled over HTTP (#468).
func (h *Hub) PostReaction(slug string, change protocol.ChatReactionCount) {
	if rm := h.occupied(slug); rm != nil {
		rm.reactionChanged(change)
	}
}

// PostChatEdit is PostChat for a line its author rewrote (#865). An edit only
// ever reaches riders who are holding the room open; anyone else reads the
// edited text straight out of the backlog when they arrive, so an empty room
// has nothing to be told.
func (h *Hub) PostChatEdit(slug string, edit protocol.ChatEdit) {
	if rm := h.occupied(slug); rm != nil {
		rm.chatEdited(edit)
	}
}

func (rm *room) chatLine(line protocol.ChatLine) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	// 256 bounds a hostile flood; the tick drains 32 per second and CARRIES
	// the rest — a burst must not silently eat accepted lines (#219).
	if len(rm.chat) < 256 {
		rm.chat = append(rm.chat, line)
	}
}

func (rm *room) chatIDAssigned(id protocol.ChatID) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	// Bounded like every tick queue; the save queue's own 256 cap means this
	// can only fill if ticks stall, and then persistence is the least worry.
	if len(rm.chatIDs) < 256 {
		rm.chatIDs = append(rm.chatIDs, id)
	}
}

func (rm *room) reactionChanged(count protocol.ChatReactionCount) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if len(rm.reacts) < 256 {
		rm.reacts = append(rm.reacts, count)
	}
}

func (rm *room) chatEdited(edit protocol.ChatEdit) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if len(rm.edits) < 256 {
		rm.edits = append(rm.edits, edit)
	}
}
