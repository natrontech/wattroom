package hub

import "github.com/natrontech/wattroom/server/internal/protocol"

// startLineLocked is the session's start line as the tick carries it
// (#3228): each joined rider in the channel with the sensors their screens
// hold, and the plan's riders who are not here yet. Nil off the line. The
// tick goes to the channel's sockets alone, so readiness never reaches the
// lobby, the sidebar or another channel. Caller holds rm.mu.
func (rm *channelState) startLineLocked() *protocol.StartLine {
	s := rm.session
	if !s.startLine() {
		return nil
	}
	line := &protocol.StartLine{Ready: make(map[string]protocol.Readiness)}
	here := make(map[string]bool, len(rm.clients))
	for c := range rm.clients {
		id := c.rider.ID
		here[id] = true
		if _, joined := s.joined[id]; !joined {
			continue
		}
		held := rm.claims[id]
		_, trainer := held["trainer"]
		_, heart := held["heart-rate"]
		line.Ready[id] = protocol.Readiness{Trainer: trainer, HeartRate: heart}
	}
	for _, r := range s.awaited {
		if !here[r.ID] {
			line.Awaited = append(line.Awaited, r)
		}
	}
	return line
}
