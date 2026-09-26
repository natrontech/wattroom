package hub

import (
	"strings"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// pokeWords is what a refusal calls each kind, so a bottle's refusal never
// talks about a poke the rider did not send.
var pokeWords = map[protocol.PokeKind]struct{ choose, cooldown string }{
	protocol.PokeKindPoke: {
		choose:   "Choose another rider to poke.",
		cooldown: "You just poked them — give them a moment to notice.",
	},
	protocol.PokeKindBottle: {
		choose:   "Choose another rider to hand a bottle to.",
		cooldown: "You just handed them a bottle — give them a moment to drink.",
	},
}

// poke routes one socket's poke — or bottle (#3022) — to the rider it names
// in this voice channel, and answers the socket either way: a deliberate tap
// the rider watches for a result (errors.md), refused or landed.
//
// A bottle is a session's: it goes only to a rider riding the session open
// in this channel, because the valley it waits for is one of that
// session's blocks. Who hands it up is anyone standing in the channel — the
// roadside is everyone who is not on that rider's bike (ADR-0064).
func (h *Hub) poke(c *client, rm *room, rider protocol.Rider, sent protocol.Poke) {
	kind := sent.Kind
	if kind == "" {
		kind = protocol.PokeKindPoke
	}
	words, known := pokeWords[kind]
	if !known {
		h.writeError(c, "validation_error", "Only a poke or a bottle can be handed to a rider.")
		return
	}
	to := strings.TrimSpace(sent.To)
	if to == "" || to == rider.ID {
		h.writeError(c, "validation_error", words.choose)
		return
	}
	if !rm.hasRider(to) {
		h.writeError(c, "invalid_request", "That rider is no longer in this voice channel.")
		return
	}
	if kind == protocol.PokeKindBottle && !rm.ridesSession(to) {
		h.writeError(c, "invalid_request", "Bottles go to riders in the session, and they are not riding it.")
		return
	}
	// The target is part of the rate-limit key: one rider cannot evade the
	// cooldown with another tab, but may still poke somebody else. The kind
	// is too, so a bottle never spends the poke.
	if !rm.allow(string(kind)+":"+to, rider.ID, h.now(), pokeCooldown) {
		// A cooldown that drops in silence reads as a broken button, and the
		// sender pokes again (errors.md).
		h.writeError(c, "rate_limited", words.cooldown)
		return
	}
	poke := protocol.Poke{
		To: to, FromID: rider.ID, From: rider.Name, At: h.now().UnixMilli(),
	}
	// A plain poke keeps the empty kind it always had on the wire.
	if kind == protocol.PokeKindBottle {
		poke.Kind = kind
	}
	if !rm.queuePoke(to, poke) {
		h.writeError(c, "invalid_request", "That rider is no longer in this voice channel.")
		return
	}
	// The sender's answer (#2721): this socket's own copy, which the client
	// reads as "it landed" because it is from them. Silence on success read
	// as a button that did nothing.
	c.sendJSON(h.log, protocol.ServerMessage{Poke: &poke})
}

// ridesSession reports whether a rider is on the timeline of the session
// open in this channel (ADR-0059) — joined, not merely standing beside it.
func (rm *room) ridesSession(riderID string) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	return rm.session.rides(riderID)
}

// hasRider is the room-scope gate: a client can name only somebody currently
// sharing this room. Membership elsewhere and guessed ids buy nothing.
func (rm *room) hasRider(riderID string) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	for c := range rm.clients {
		if c.rider.ID == riderID {
			return true
		}
	}
	return false
}

// queuePoke addresses every socket belonging to one rider. It queues rather
// than writing because the tick goroutine is the only writer per socket.
func (rm *room) queuePoke(riderID string, poke protocol.Poke) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	found := false
	if rm.pendingPokes == nil {
		rm.pendingPokes = make(map[*client][]protocol.Poke)
	}
	for c := range rm.clients {
		if c.rider.ID == riderID {
			rm.pendingPokes[c] = append(rm.pendingPokes[c], poke)
			found = true
		}
	}
	return found
}

// drainPokesLocked hands the tick loop its addressed messages and forgets
// them. The caller holds the room lock.
func (rm *room) drainPokesLocked() map[*client][]protocol.Poke {
	if len(rm.pendingPokes) == 0 {
		return nil
	}
	out := rm.pendingPokes
	rm.pendingPokes = nil
	return out
}

// PokeRider hands a poke to every socket the rider holds, in whichever
// channel they are in (#2721): the live arm of a poke the DM thread records.
// A rider in no channel hears it from the thread's poll instead.
func (h *Hub) PokeRider(riderID string, poke protocol.Poke) {
	rooms := h.liveRooms()
	for _, rm := range rooms {
		rm.queuePoke(riderID, poke)
	}
}
