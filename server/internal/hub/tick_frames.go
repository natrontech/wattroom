package hub

import (
	"encoding/json"
	"log/slog"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// tickFrames marshals one tick at most four ways, each once and only when a
// socket is owed it. Once for the room, not once per rider (#670): the tick
// is the same for everyone in it, and marshalling it per client put the same
// work N times on the critical path between one slow socket and the next.
// Two things are not for everyone:
//
//   - the workout definition (#1710): the shared payload names it by hash,
//     and the JSON goes only to a socket that has not heard this hash;
//   - a closed session's scores (#2819): ADR-0058 keeps the closing card for
//     the riders who rode it, and a member who joins the channel afterwards
//     must not read everyone's execution off the wire.
type tickFrames struct {
	tick    *protocol.ServerTick
	log     *slog.Logger
	channel string
	built   map[frameKind][]byte
}

type frameKind struct{ workout, scores, deck bool }

// frame is nil when the tick could not be marshalled, remembered so the
// failure is logged once per tick and kind.
func (f *tickFrames) frame(kind frameKind) []byte {
	if b, done := f.built[kind]; done {
		return b
	}
	b := f.marshal(kind, f.tick.Cheers)
	if f.built == nil {
		f.built = make(map[frameKind][]byte, 8)
	}
	f.built[kind] = b
	return b
}

// withCheers is one socket's own copy of the frame, carrying only the cheers
// it may hear (#3202). Never cached: it is that socket's alone.
func (f *tickFrames) withCheers(kind frameKind, cheers []protocol.Cheer) []byte {
	return f.marshal(kind, cheers)
}

func (f *tickFrames) marshal(kind frameKind, cheers []protocol.Cheer) []byte {
	t := *f.tick
	t.Cheers = cheers
	if !kind.workout {
		t.State.WorkoutJSON = ""
	}
	if !kind.scores {
		t.Execution = nil
	}
	if !kind.deck {
		t.Jukebox = nil
	}
	b, err := json.Marshal(protocol.ServerMessage{Tick: &t})
	if err != nil {
		logger(f.log).Error("tick could not be marshalled", "channel", f.channel, "workout", kind.workout, "scores", kind.scores, "deck", kind.deck, "err", err)
		return nil
	}
	return b
}

// sendTick hands every socket its frame of the tick, and what is addressed to
// it alone. Runs after rm.mu is released.
func (rm *channelState) sendTick(log *slog.Logger, out *tickOut) {
	metricTicks.Inc()
	frames := tickFrames{tick: &out.tick, log: log, channel: rm.channel}
	for _, c := range out.clients {
		_, scores := out.rode[c.rider.ID]
		scores = scores || out.rode == nil
		// Half a tick is worse than none: a frame that did not marshal
		// is skipped, and said so. The workout (#1710) and the deck
		// (#2838) ride only to a socket that has not heard them; a full
		// frame that fails to marshal falls back to the light one and
		// leaves both owed.
		light := frameKind{scores: scores}
		kind := frameKind{
			scores:  scores,
			workout: c.workoutSent != out.tick.State.WorkoutHash,
			deck:    c.jukeboxSent != out.tick.JukeboxRev,
		}
		frame := frames.frame(light)
		if frame != nil && kind != light {
			if full := frames.frame(kind); full != nil {
				frame = full
			} else {
				kind = light
			}
		}
		// A cheer from someone hidden from this rider, or whom they hid,
		// is cut from their copy alone (#3202) — a rare second, so the
		// frame is marshalled for them rather than cached for the room.
		if frame != nil {
			if own, cut := rm.cheersFor(c.rider.ID, out.tick.Cheers, out.cheerFrom); cut {
				frame = frames.withCheers(kind, own)
			}
		}
		// Marked heard only when the frame was actually queued: a dropped
		// frame (slow socket) leaves it owed, and the next tick tries
		// again rather than believing it arrived.
		if frame != nil && c.send(frame) {
			if kind.workout {
				c.workoutSent = out.tick.State.WorkoutHash
			}
			if kind.deck {
				c.jukeboxSent = out.tick.JukeboxRev
			}
		}
		// Addressed to this socket alone, so it cannot be folded into the
		// tick — but it rides the same queue, so it keeps its order.
		if answer, ok := out.pairing[c]; ok {
			c.sendJSON(log, protocol.ServerMessage{Pairing: &answer})
		}
		for _, pending := range out.pokes[c] {
			poke := pending
			c.sendJSON(log, protocol.ServerMessage{Poke: &poke})
		}
	}
}
