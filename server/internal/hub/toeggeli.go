package hub

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/safego"
)

// ToeggeliKeeper keeps a match won at a voice channel's table on its crew's
// board. Defined here, where it is consumed; crews implements it. Won returns
// at once: the write happens off the hub's goroutines.
type ToeggeliKeeper interface {
	Won(channel, rider string)
}

// SetToeggeliKeeper wires the store that keeps the table's wins.
func (h *Hub) SetToeggeliKeeper(k ToeggeliKeeper) { h.toeggeliKeep = k }

// A challenge stands this long, and a rider may send one this often.
const (
	toeggeliInviteFor = 30 * time.Second
	toeggeliInviteGap = 2 * time.Second
)

type toeggeliInvite struct {
	to    string
	until time.Time
}

// toeggeli takes a rider's move at the room's table football.
func (h *Hub) toeggeli(c *client, rm *channelState, rider protocol.Rider, cmd protocol.ToeggeliCommand) {
	switch cmd.Op {
	case protocol.ToeggeliMove:
		rm.mu.Lock()
		if rm.table != nil {
			rm.table.move(rider.ID, cmd.Y, cmd.Kick)
		}
		rm.mu.Unlock()
	case protocol.ToeggeliChallenge:
		h.challenge(c, rm, rider, strings.TrimSpace(cmd.To))
	case protocol.ToeggeliAccept:
		h.acceptChallenge(c, rm, rider, strings.TrimSpace(cmd.To))
	case protocol.ToeggeliDecline:
		from := strings.TrimSpace(cmd.To)
		rm.mu.Lock()
		gone := rm.dropInvitesLocked(rider.ID, from)
		rm.mu.Unlock()
		h.sayInvitesGone(rm, gone)
	case protocol.ToeggeliLeave:
		rm.mu.Lock()
		if t := rm.table; t != nil && t.state.Phase != protocol.ToeggeliOver &&
			(t.state.Left == rider.ID || t.state.Right == rider.ID) {
			t.state.Ended = "left"
			t.state.Winner = ""
			t.state.Phase = protocol.ToeggeliOver
			t.pause = 0
		}
		rm.mu.Unlock()
	default:
		h.writeError(c, "validation_error", "That is not a move at the table.")
	}
}

func (h *Hub) challenge(c *client, rm *channelState, rider protocol.Rider, to string) {
	if to == "" || to == rider.ID {
		h.writeError(c, "validation_error", "Pick someone in the voice channel to play.")
		return
	}
	if !rm.hasRider(to) {
		h.writeError(c, "invalid_request", "That rider is no longer in this voice channel.")
		return
	}
	if !rm.allow("toeggeli", rider.ID, h.now(), toeggeliInviteGap) {
		h.writeError(c, "rate_limited", "One challenge at a time: wait a moment and ask again.")
		return
	}
	now := h.now()
	invite := protocol.ToeggeliInvite{
		From: rider.ID, FromName: rider.Name, To: to, Until: now.Add(toeggeliInviteFor).UnixMilli(),
	}
	// Across a hidden pair the challenge goes nowhere, and the sender is
	// answered as if it landed (#3202).
	if rm.hides(rider.ID, to) {
		c.sendJSON(h.log, protocol.ServerMessage{Invite: &invite})
		return
	}
	rm.mu.Lock()
	if rm.table != nil {
		rm.mu.Unlock()
		h.writeError(c, "conflict", "The table is taken. Watch this match and challenge the winner.")
		return
	}
	if rm.invites == nil {
		rm.invites = make(map[string]toeggeliInvite)
	}
	rm.invites[rider.ID] = toeggeliInvite{to: to, until: now.Add(toeggeliInviteFor)}
	targets := rm.socketsLocked(rider.ID, to)
	rm.mu.Unlock()
	sendAll(h, targets, protocol.ServerMessage{Invite: &invite})
}

func (h *Hub) acceptChallenge(c *client, rm *channelState, rider protocol.Rider, from string) {
	now := h.now()
	rm.mu.Lock()
	inv, ok := rm.invites[from]
	if !ok || inv.to != rider.ID || !now.Before(inv.until) {
		rm.mu.Unlock()
		h.writeError(c, "invalid_request", "That challenge has lapsed. Ask for a new one.")
		return
	}
	if rm.table != nil {
		rm.mu.Unlock()
		h.writeError(c, "conflict", "The table is taken. Watch this match and challenge the winner.")
		return
	}
	fromName := ""
	for cl := range rm.clients {
		if cl.rider.ID == from {
			fromName = cl.rider.Name
		}
	}
	if fromName == "" {
		rm.mu.Unlock()
		h.writeError(c, "invalid_request", "That rider is no longer in this voice channel.")
		return
	}
	// Every challenge either of them sent or was sent goes with the match.
	gone := rm.dropInvitesLocked(from, "")
	gone = append(gone, rm.dropInvitesLocked(rider.ID, "")...)
	t := newTable(from, fromName, rider.ID, rider.Name)
	rm.table = t
	rm.mu.Unlock()
	h.sayInvitesGone(rm, gone)
	h.playToeggeli(rm, t)
}

// dropInvitesLocked takes back the challenges between a rider and another,
// both ways; an empty other is everyone. It returns them, to be told gone.
func (rm *channelState) dropInvitesLocked(rider, other string) []protocol.ToeggeliInvite {
	var gone []protocol.ToeggeliInvite
	for from, inv := range rm.invites {
		mine := from == rider && (other == "" || inv.to == other)
		theirs := inv.to == rider && (other == "" || from == other)
		if mine || theirs {
			gone = append(gone, protocol.ToeggeliInvite{From: from, To: inv.to, Gone: true})
			delete(rm.invites, from)
		}
	}
	return gone
}

func (h *Hub) sayInvitesGone(rm *channelState, gone []protocol.ToeggeliInvite) {
	for _, inv := range gone {
		rm.mu.Lock()
		targets := rm.socketsLocked(inv.From, inv.To)
		rm.mu.Unlock()
		sendAll(h, targets, protocol.ServerMessage{Invite: &inv})
	}
}

// socketsLocked is every socket of the riders named. The caller holds rm.mu.
func (rm *channelState) socketsLocked(riders ...string) []*client {
	var out []*client
	for c := range rm.clients {
		for _, id := range riders {
			if c.rider.ID == id {
				out = append(out, c)
				break
			}
		}
	}
	return out
}

func sendAll(h *Hub, to []*client, msg protocol.ServerMessage) {
	frame, err := json.Marshal(msg)
	if err != nil {
		logger(h.log).Error("table message could not be marshalled", "err", err)
		return
	}
	for _, c := range to {
		c.send(frame)
	}
}

// playToeggeli runs a match toeggeliHz times a second and sends it to
// everyone in the channel. It returns once the result has shown, when the
// table holds another match, or when the channel closes.
func (h *Hub) playToeggeli(rm *channelState, t *table) {
	safego.Go(h.log, "toeggeli "+rm.channel, func() {
		ticker := time.NewTicker(time.Second / toeggeliHz)
		defer ticker.Stop()
		for {
			select {
			case <-rm.stop:
				return
			case <-ticker.C:
			}
			rm.mu.Lock()
			if rm.table != t {
				rm.mu.Unlock()
				return
			}
			_, over := t.step(1.0 / toeggeliHz)
			// A player gone from the channel ends it, with no winner.
			if t.state.Phase != protocol.ToeggeliOver &&
				(!rm.presentLocked(t.state.Left) || !rm.presentLocked(t.state.Right)) {
				t.state.Ended, t.state.Winner, t.state.Phase, t.pause = "left", "", protocol.ToeggeliOver, 0
			}
			state := t.state
			done := t.done()
			if done {
				rm.table = nil
				state.Phase = protocol.ToeggeliCleared
			}
			everyone := rm.socketsAllLocked()
			rm.mu.Unlock()
			sendAll(h, everyone, protocol.ServerMessage{Toeggeli: &state})
			if over && state.Winner != "" && h.toeggeliKeep != nil {
				h.toeggeliKeep.Won(rm.channel, state.Winner)
			}
			if done {
				return
			}
		}
	})
}

// socketsAllLocked is every socket in the channel. The caller holds rm.mu.
func (rm *channelState) socketsAllLocked() []*client {
	out := make([]*client, 0, len(rm.clients))
	for c := range rm.clients {
		out = append(out, c)
	}
	return out
}
