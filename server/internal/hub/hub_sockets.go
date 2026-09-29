package hub

// How many sockets one rider may hold open at once, across every channel and
// the lobby. Split from hub.go (#3357).

// maxSocketsPerRider is generous — a phone, a laptop, a TV and a few tabs —
// and far under what makes join and leave O(lobby) for one account (#1415).
const maxSocketsPerRider = 16

// admitSocket counts one more open socket for the rider, refusing past the cap.
func (h *Hub) admitSocket(riderID string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.sockets[riderID] >= maxSocketsPerRider {
		return false
	}
	h.sockets[riderID]++
	return true
}

func (h *Hub) releaseSocket(riderID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	releaseCount(h.sockets, riderID)
}

// releaseCount drops one from a counter map, deleting the key on the last —
// what keeps h.sockets and h.holds bounded by what is live rather than by
// everything that ever was. Caller holds h.mu.
func releaseCount(counts map[string]int, key string) {
	if counts[key] <= 1 {
		delete(counts, key)
		return
	}
	counts[key]--
}
