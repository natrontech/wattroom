package hub

// ChannelsRiding is every channel whose open session rides route right now
// (#3096): the road endpoint serves a route to the members of those channels,
// and only while the session lasts. One room's lock at a time, never with the
// hub's (liveChannels).
func (h *Hub) ChannelsRiding(route string) []string {
	var out []string
	for _, rm := range h.liveChannels() {
		rm.mu.Lock()
		if rm.session.open() && rm.session.route != nil && rm.session.route.ID == route {
			out = append(out, rm.channel)
		}
		rm.mu.Unlock()
	}
	return out
}
