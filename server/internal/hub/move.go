package hub

import (
	"errors"
	"slices"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

var (
	// ErrNotInChannel: the rider holds no socket in the channel — they left
	// between the drag and the drop.
	ErrNotInChannel = errors.New("rider is not in the channel")
	// ErrRiding: the rider is pedalling there, and a move would end the ride.
	ErrRiding = errors.New("rider is pedalling")
)

// Move tells every socket a rider holds in channel to go to another voice
// channel (#2730). The client goes, carrying its call; the hub only says
// where. A pedalling rider stays put: a ride is not ended by somebody else's
// gesture, which is what ride-guard.svelte.ts keeps a stray tap from doing
// (#2602).
func (h *Hub) Move(channel, userID string, to protocol.Moved) error {
	h.mu.Lock()
	rm := h.rooms[channel]
	h.mu.Unlock()
	if rm == nil {
		return ErrNotInChannel
	}
	rm.mu.Lock()
	_, riding := rm.ridingLocked(h.now())
	var sockets []*client
	for c := range rm.clients {
		if c.rider.ID == userID {
			sockets = append(sockets, c)
		}
	}
	rm.mu.Unlock()
	if len(sockets) == 0 {
		return ErrNotInChannel
	}
	if slices.Contains(riding, userID) {
		return ErrRiding
	}
	// c.out is a buffered queue that nothing closes, so sending after the
	// unlock is safe even for a socket leaving right now.
	for _, c := range sockets {
		c.sendJSON(h.log, protocol.ServerMessage{Moved: &to})
	}
	h.log.Info("rider moved", "from", channel, "to", to.Channel, "rider", userID)
	return nil
}
