package hub

// SetStanding carries a rider's level and rider streak to every channel they
// stand in, after a ride of theirs is saved. The door reads both when a socket
// opens, so without this the cozy room showed the level a rider walked in
// with until they rejoined, and never saw the level they just rode to. The
// caller has read both from the store; the hub only copies them in.
func (h *Hub) SetStanding(riderID string, totalXp int64, streakWeeks int) {
	for _, rm := range h.liveChannels() {
		rm.setStanding(riderID, totalXp, streakWeeks)
	}
}

// setStanding is SetStanding for one room: every socket of the rider's, the
// session's copy of them, and the copy a dropped socket left behind (#4090).
// XP only goes up (ADR-0047), so a read that raced an older one cannot lower it.
func (rm *channelState) setStanding(riderID string, totalXp int64, streakWeeks int) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	for c := range rm.clients {
		if c.rider.ID == riderID {
			c.rider.TotalXp = max(c.rider.TotalXp, totalXp)
			c.rider.StreakWeeks = streakWeeks
		}
	}
	if seen, ok := rm.seen[riderID]; ok {
		seen.TotalXp, seen.StreakWeeks = max(seen.TotalXp, totalXp), streakWeeks
		rm.seen[riderID] = seen
	}
	if gone, ok := rm.departedRiders[riderID]; ok {
		gone.TotalXp, gone.StreakWeeks = max(gone.TotalXp, totalXp), streakWeeks
		rm.departedRiders[riderID] = gone
	}
}
