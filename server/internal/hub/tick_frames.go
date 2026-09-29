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
