package hub

import (
	"time"
	"unicode/utf8"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// remoteMinGap is the ceiling on one rider's remote presses per action. Talk's
// keepalive beats faster than the shifter's own 100 ms, so it is never the one
// refused.
const remoteMinGap = 100 * time.Millisecond

// remote relays a phone remote's press to the one tab of the same rider that
// holds the trainer (#3217). Not the tick and not the room: the holder's
// sockets get it from here, through their own write queue.
//
// A tap the rider watches (a shift, a camera) is answered when refused
// (errors.md). The keepalive stays quiet, and talk-up is never limited: it
// only ever makes the room quieter.
func (h *Hub) remote(c *client, rm *channelState, rider protocol.Rider, cmd protocol.RemoteCommand) {
	if !protocol.IsRemoteAction(cmd.Action) {
		h.writeError(c, "remote_validation_error", "That is not something the remote can do.")
		return
	}
	if cmd.Action != "talk-up" && !rm.allow("remote:"+cmd.Action, rider.ID, h.now(), remoteMinGap) {
		if cmd.Action != "talk-keepalive" {
			h.writeError(c, "remote_rate_limited", "That was quick — give the remote a moment.")
		}
		return
	}
	holders := rm.remoteHolders(c, cmd)
	if len(holders) == 0 {
		h.writeError(c, "remote_conflict", "No ride is running on another of your screens.")
		return
	}
	frame := protocol.ServerMessage{Remote: &cmd}
	for _, holder := range holders {
		holder.sendJSON(h.log, frame)
	}
}

// remoteHolders is the sockets of the sender's rider on the tab holding the
// trainer, never the sender's own tab. It also keeps who holds Talk, so a
// dropped phone can be let go of.
func (rm *channelState) remoteHolders(from *client, cmd protocol.RemoteCommand) []*client {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	owner, taken := rm.claims[from.rider.ID]["trainer"]
	if !taken || owner.tab == tabOf(from) {
		return nil
	}
	switch cmd.Action {
	case "talk-down":
		if rm.talking == nil {
			rm.talking = make(map[string]string)
		}
		rm.talking[from.rider.ID] = tabOf(from)
	case "talk-up":
		delete(rm.talking, from.rider.ID)
	}
	return rm.holdersLocked(from.rider.ID, owner.tab)
}

func (rm *channelState) holdersLocked(riderID, tab string) []*client {
	var out []*client
	for other := range rm.clients {
		if other.rider.ID == riderID && tabOf(other) == tab {
			out = append(out, other)
		}
	}
	return out
}

// releaseTalkLocked lets go of Talk when the socket holding it was the
// rider's last on its tab: a phone dropped mid-hold never leaves a hot mic.
// A reload's newer socket on the same tab keeps the hold alive, like claims.
func (rm *channelState) releaseTalkLocked(c *client) {
	tab, held := rm.talking[c.rider.ID]
	if !held || tab != tabOf(c) || len(rm.holdersLocked(c.rider.ID, tab)) > 0 {
		return
	}
	delete(rm.talking, c.rider.ID)
	if owner, taken := rm.claims[c.rider.ID]["trainer"]; taken {
		up := protocol.ServerMessage{Remote: &protocol.RemoteCommand{Action: "talk-up"}}
		for _, holder := range rm.holdersLocked(c.rider.ID, owner.tab) {
			holder.sendJSON(nil, up)
		}
	}
}

// tabOf is a socket's tab label, or its own identity when it sent none.
func tabOf(c *client) string {
	if c.tab != "" {
		return c.tab
	}
	return c.tabFallback()
}

// gearState forwards the trainer-holding tab's gear to the rider's other
// screens (#3217). Only the holder may speak it, so a phone cannot put a gear
// on the desktop's remote. Quiet when refused: the holder sends it on its own.
func (h *Hub) gearState(c *client, rm *channelState, rider protocol.Rider, g protocol.GearState) {
	if g.Label == "" || utf8.RuneCountInString(g.Label) > protocol.MaxGearLabel {
		return
	}
	h.fromHolder(c, rm, rider, "gear", protocol.ServerMessage{Gear: &g})
}

// pauseState forwards the holder's pause state the same way gearState does.
func (h *Hub) pauseState(c *client, rm *channelState, rider protocol.Rider, p protocol.PauseState) {
	h.fromHolder(c, rm, rider, "pause", protocol.ServerMessage{Pause: &p})
}

// viewState forwards the holder's page and view the same way gearState
// does (#4223), its page bounded as the gear's label is.
func (h *Hub) viewState(c *client, rm *channelState, rider protocol.Rider, v protocol.ViewState) {
	if utf8.RuneCountInString(v.Page) > protocol.MaxViewPage ||
		utf8.RuneCountInString(v.Camera) > protocol.MaxViewPage || v.Pictures < 0 {
		return
	}
	h.fromHolder(c, rm, rider, "view", protocol.ServerMessage{View: &v})
}

// fromHolder sends frame to the rider's screens other than the
// trainer-holding tab, and only when c is that tab.
func (h *Hub) fromHolder(c *client, rm *channelState, rider protocol.Rider, kind string, frame protocol.ServerMessage) {
	if !rm.allow(kind, rider.ID, h.now(), remoteMinGap) {
		return
	}
	rm.mu.Lock()
	owner, taken := rm.claims[rider.ID]["trainer"]
	var others []*client
	if taken && owner.tab == tabOf(c) {
		for other := range rm.clients {
			if other.rider.ID == rider.ID && tabOf(other) != owner.tab {
				others = append(others, other)
			}
		}
	}
	rm.mu.Unlock()
	for _, other := range others {
		other.sendJSON(h.log, frame)
	}
}
