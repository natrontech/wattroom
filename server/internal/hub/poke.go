package hub

import "github.com/natrontech/wattroom/server/internal/protocol"

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
