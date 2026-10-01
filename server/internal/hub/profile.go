package hub

import "github.com/natrontech/wattroom/server/internal/protocol"

// SetProfile carries a saved profile to the rider's open sockets, in every
// channel they stand in. The rider struct is captured when a socket opens,
// the way SetRole's role was: an FTP changed mid-session left the hub
// scoring against the old one while the rider's own trainer held targets
// from the new, and they read off target however well they held it.
func (h *Hub) SetProfile(p protocol.Rider) {
	rooms := h.liveChannels()
	for _, rm := range rooms {
		rm.setProfile(p)
	}
}

// setProfile is SetProfile for one room. The seen copy moves with it, since
// the next sample would overwrite it anyway and a podium read before that
// must not name the rider by their old name.
func (rm *channelState) setProfile(p protocol.Rider) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	for c := range rm.clients {
		if c.rider.ID == p.ID {
			c.rider = withProfile(c.rider, p)
		}
	}
	if seen, ok := rm.seen[p.ID]; ok {
		rm.seen[p.ID] = withProfile(seen, p)
	}
}

// withProfile is r with what a profile save moves: the name, and the two
// numbers with where they came from and when the weight last moved — a
// weight changed mid-session must not reach a race's flag dated as settled
// (#3169).
func withProfile(r, p protocol.Rider) protocol.Rider {
	r.Name, r.FtpWatts, r.WeightKg = p.Name, p.FtpWatts, p.WeightKg
	r.FtpSource, r.WeightSource = p.FtpSource, p.WeightSource
	r.WeightChangedAt, r.WeightConfirmedAt = p.WeightChangedAt, p.WeightConfirmedAt
	return r
}
