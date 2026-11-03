package hub

import "github.com/natrontech/wattroom/server/internal/protocol"

// CheerAfar hands one rider in a voice channel a cheer from a crewmate who
// is not in it (#3275). The caller has already asked the gate: the sender
// may enter this channel, so they see To on Home's around-now, and the
// budget allowed it. It rides To's own copy of the next tick and nobody
// else's. False when To is not in the channel. Across a hidden pair it goes
// nowhere and answers true, so the sender is never told (#3202).
func (h *Hub) CheerAfar(channel string, cheer protocol.Cheer) bool {
	h.mu.Lock()
	rm := h.states[channel]
	h.mu.Unlock()
	if rm == nil || cheer.To == "" {
		return false
	}
	cheer.Afar = true
	hidden := rm.hides(cheer.FromID, cheer.To)
	rm.mu.Lock()
	defer rm.mu.Unlock()
	found := false
	for c := range rm.clients {
		if c.rider.ID != cheer.To {
			continue
		}
		found = true
		if hidden {
			continue
		}
		if rm.pendingAfar == nil {
			rm.pendingAfar = make(map[*client][]protocol.Cheer)
		}
		// Bounded as a tick's own cheers are: the budget is per sender and
		// rider, so a whole crew cheering at once is the ceiling's case.
		if len(rm.pendingAfar[c]) < 32 {
			rm.pendingAfar[c] = append(rm.pendingAfar[c], cheer)
		}
	}
	return found
}
