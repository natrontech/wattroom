package hub

// SetProfile carries a saved profile to the rider's open sockets, in every
// channel they stand in. The rider struct is captured when a socket opens,
// the way SetRole's role was: an FTP changed mid-session left the hub
// scoring against the old one while the rider's own trainer held targets
// from the new, and they read off target however well they held it.
func (h *Hub) SetProfile(userID, name string, ftpWatts, weightKg int) {
	h.mu.Lock()
	rooms := make([]*room, 0, len(h.rooms))
	for _, rm := range h.rooms {
		rooms = append(rooms, rm)
	}
	h.mu.Unlock()
	for _, rm := range rooms {
		rm.setProfile(userID, name, ftpWatts, weightKg)
	}
}

// setProfile is SetProfile for one room. The seen copy moves with it, since
// the next sample would overwrite it anyway and a podium read before that
// must not name the rider by their old name.
func (rm *room) setProfile(userID, name string, ftpWatts, weightKg int) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	for c := range rm.clients {
		if c.rider.ID == userID {
			c.rider.Name, c.rider.FtpWatts, c.rider.WeightKg = name, ftpWatts, weightKg
		}
	}
	if seen, ok := rm.seen[userID]; ok {
		seen.Name, seen.FtpWatts, seen.WeightKg = name, ftpWatts, weightKg
		rm.seen[userID] = seen
	}
}
