package hub

// What a voice channel's socket may say, one handler per kind of message
// (#3357). HandleWS reads; handleMessage takes each part of what it read.

import (
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// handleMessage takes one client message, kind by kind.
func (h *Hub) handleMessage(c *client, rm *channelState, channel string, rider protocol.Rider, msg protocol.ClientMessage) {
	// One message may carry several kinds; each is taken in this order.
	if msg.Sensors != nil {
		// Claims are per rider and cost one comparison per kind, so they
		// need no rate limit of their own — a client repeating itself
		// changes nothing and queues nothing.
		if rm.claimSensors(c, *msg.Sensors) {
			rm.announcePairing(rider.ID)
		}
	}
	if msg.Poke != nil {
		h.poke(c, rm, rider, *msg.Poke)
	}
	if msg.Device != nil {
		// Untrusted input, bounded at the boundary to the closed set
		// (errors.md): the room renders this, and anything outside the
		// three words is dropped rather than shown to everyone. Costs one
		// comparison and changes nothing when repeated, so no rate limit
		// of its own — the same reasoning as the sensor claim above.
		rm.setDeviceKind(c, msg.Device.Kind)
	}
	if msg.Away != nil {
		// Unlimited like a sensor claim, and for the same reason: it is
		// one map write per rider, so a client repeating itself changes
		// nothing and queues nothing. The state rides the next tick.
		rm.setAway(rider.ID, msg.Away.Away, msg.Away.Reason)
	}
	if msg.Metrics != nil {
		// Rate-shaped like every other channel (audit 2026-09-09): a trainer
		// notifies at 4 Hz at most, so 10/s is headroom, and the record
		// admits one sample per second anyway.
		if m := *msg.Metrics; validMetrics(m) && rm.allow("metrics", rider.ID, h.now(), metricsMinGap) {
			rm.setMetrics(c, m)
		}
	}
	if msg.Board != nil {
		h.board(rm, rider, *msg.Board)
	}
	if msg.Cheer != nil {
		if protocol.IsReaction(msg.Cheer.Emoji) && rm.allow("cheer", rider.ID, h.now(), time.Second) {
			rm.cheer(protocol.Cheer{Emoji: msg.Cheer.Emoji, From: rider.Name}, rider.ID)
		}
	}
	if msg.Jukebox != nil {
		h.jukebox(c, rm, channel, rider, *msg.Jukebox)
	}
	// A backfill turned away skips the rest of the message, as it always has.
	if msg.Backfill != nil && !h.backfill(c, rm, channel, rider, *msg.Backfill) {
		return
	}
	if msg.Control != nil {
		h.control(c, rm, rider, *msg.Control)
	}
}

// board is a soundboard fire, or a stop.
func (h *Hub) board(rm *channelState, rider protocol.Rider, cmd protocol.Board) {
	switch {
	case cmd.ClipID == "":
		// A stop (#1321) takes no cooldown: it only ever makes the room
		// quieter, and the fire it takes back is half a second old.
		// fire() is what bounds a rider's stops.
		rm.fire(protocol.Board{FromID: rider.ID, From: rider.Name})
	case protocol.IsClipID(cmd.ClipID) && rm.allow("board", rider.ID, h.now(), time.Second):
		// One fire a second per rider (docs/SPEC.md), the same ceiling a
		// cheer takes — and on the server, because a client asking nicely
		// is not a limit.
		rm.fire(protocol.Board{ClipID: cmd.ClipID, FromID: rider.ID, From: rider.Name})
	}
}

// jukebox is a deck command, answered when it is refused.
func (h *Hub) jukebox(c *client, rm *channelState, channel string, rider protocol.Rider, cmd protocol.JukeboxCommand) {
	// Any member; the jukebox validates its own input. Throttled like
	// every other input — it was the one unlimited channel (audit #219).
	if rm.allow("jukebox", rider.ID, h.now(), 300*time.Millisecond) {
		if played, _, refusal := rm.jukeboxWithRefusal(cmd, rider.ID, rider.Name, h.now()); refusal != "" {
			h.writeError(c, jukeboxCode(refusal.code()), refusal.message())
		} else if played != nil && h.xp != nil {
			h.xp.TrackPlayed(channel, played.riderID, played.ref, h.now())
		}
	} else {
		// Skip, pause, queue: deliberate taps a rider watches for a
		// result, so a refused one has to say so (#2232). Every other
		// way this channel refuses already answers — the jukebox's own
		// refusals right above — and the throttle was the one that did
		// not, which reads as the button not working.
		h.writeError(c, jukeboxCode("rate_limited"), "That was quick — give the deck a moment.")
	}
}

// backfill is a reconnect's replay; false when it was turned away.
func (h *Hub) backfill(c *client, rm *channelState, channel string, rider protocol.Rider, cmd protocol.Backfill) bool {
	// A reconnect's replay: into the ride record only — stale samples
	// must never repaint anyone's live tile. Batch size is bounded like
	// every other client input.
	samples := cmd.Samples
	if len(samples) > protocol.MaxBackfillBatch {
		h.log.Warn("backfill truncated", "channel", channel, "rider", rider.ID, "samples", len(samples), "kept", protocol.MaxBackfillBatch)
		samples = samples[:protocol.MaxBackfillBatch]
	}
	// One batch a second: it runs 600 validations under the room's
	// lock, and it was the one channel a member could loop unlimited
	// (audit 2026-09-09).
	if !rm.allow("backfill", rider.ID, h.now(), time.Second) {
		return false
	}
	rm.backfill(c, samples, h.log, h.saver)
	h.log.Debug("backfill received", "channel", channel, "rider", rider.ID, "samples", len(samples))
	return true
}

// control is a session command: the vocabulary, the throttle, the role, then
// the action.
func (h *Hub) control(c *client, rm *channelState, rider protocol.Rider, cmd protocol.Control) {
	// The vocabulary first: the action is part of the throttle's key,
	// so an unknown one must not reach the room's map of allowances.
	if !protocol.IsControlAction(cmd.Action) {
		h.writeError(c, "validation_error", "That is not something a session can do.")
		return
	}
	// Throttled like every other input (#3019), ahead of the role and
	// pick checks it would otherwise leave free to loop. Pick, start,
	// pause: deliberate taps a rider watches for a result, so a
	// refused one says so (#2232).
	//
	// Join and leave are unlimited, like away above: each is one set
	// entry for this rider's own id, broadcasting, writing and
	// queueing nothing, and the next tick carries it. The session
	// page also sends join by itself, so a rider's second tab had its
	// join refused and read "That was quick" over a tap nobody made.
	if a := cmd.Action; a != "join" && a != "leave" &&
		!rm.allow("control:"+a, rider.ID, h.now(), controlMinGap) {
		h.writeError(c, "rate_limited", "That was quick — give the session a moment, then try again.")
		return
	}
	// The rider on THIS socket, not the copy captured when it opened:
	// a crew role change mid-session has to land without a reconnect.
	rider = rm.riderOf(c)
	if code, refusal := rm.refusal(cmd.Action, rider); code != "" {
		h.writeError(c, code, refusal)
		return
	}
	if cmd.Action == "game" {
		route, refused := h.askedRoute(cmd, rider.ID)
		if refused != nil {
			h.writeError(c, refused.Code, refused.Message)
			return
		}
		if refusal := rm.startGameOn(cmd.GameMode, route, rider, h.now()); refusal != "" {
			h.writeError(c, "invalid_request", refusal)
		}
		return
	}
	if cmd.Action == "game-end" {
		if !rm.endGame(h.now()) {
			h.writeError(c, "invalid_request", "No game is running.")
		}
		return
	}
	if cmd.Action == "sprint" {
		// Arm sprint moments: the coach's (matrix), only mid-session.
		if rm.armIfRunning(h.now()) {
			return
		}
		h.writeError(c, "invalid_request", "Sprints arm during a running session.")
		return
	}
	var route *protocol.SessionRoute
	if cmd.Action == "pick" {
		if refusal := checkPick(cmd); refusal != "" {
			h.writeError(c, "validation_error", refusal)
			return
		}
		// Before the cut is attached: the road is checked against the
		// workout's own reference, which reads nothing else.
		var refused *protocol.Error
		if route, refused = h.askedRoute(cmd, rider.ID); refused != nil {
			h.writeError(c, refused.Code, refused.Message)
			return
		}
		attached, name, refusal := h.sessionRoad(cmd.WorkoutJSON, cmd.WorkoutName, rider.ID)
		if refusal != "" {
			h.writeError(c, "forbidden", refusal)
			return
		}
		cmd.WorkoutJSON, cmd.WorkoutName = attached, name
	}
	if code, refusal := rm.controlOn(cmd, route, rider, h.now()); code != "" {
		h.writeError(c, code, refusal)
	}
}

// askedRoute is the road a pick or a game asked for, resolved; nil when it
// asked for none.
func (h *Hub) askedRoute(cmd protocol.Control, coach string) (*protocol.SessionRoute, *protocol.Error) {
	if cmd.Route == nil || cmd.Action != "pick" && cmd.Action != "game" {
		return nil, nil
	}
	route, refused := h.sessionRoute(*cmd.Route, cmd.WorkoutJSON, coach)
	if refused != nil {
		return nil, refused
	}
	return &route, nil
}
