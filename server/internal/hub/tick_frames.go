package hub

import (
	"encoding/json"
	"log/slog"
	"slices"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// tickFrames marshals one tick a few ways, each once and only when a
// socket is owed it. Once for the room, not once per rider (#670): the tick
// is the same for everyone in it, and marshalling it per client put the same
// work N times on the critical path between one slow socket and the next.
// Three things are not for everyone:
//
//   - the workout definition (#1710): the shared payload names it by hash,
//     and the JSON goes only to a socket that has not heard this hash;
//   - a closed session's scores (#2819): ADR-0058 keeps the closing card for
//     the riders who rode it, and a member who joins the channel afterwards
//     must not read everyone's execution off the wire — nor a race's results,
//     its card or its finish times, which only its riders see (ADR-0067).
//     The race itself, racers moving on the road, the channel may watch;
//   - where free riders are on a road (#3117): only to the riders on it;
//   - why a racer rode unranked (#3779): only to that racer, never the field.
type tickFrames struct {
	tick    *protocol.ServerTick
	log     *slog.Logger
	channel string
	built   map[frameKind][]byte
	// Free riders, whose numbers reach their own sockets alone.
	free map[string]struct{}
}

// road is the shared road the frame's rider free-rides (#3117), 0 for none:
// riders on it alone are sent where its riders are. own is the racer whose
// unranked why the card keeps, set only while the card tells anyone why.
type frameKind struct {
	workout, scores, deck bool
	road                  int
	own                   string
	// The free rider this copy is for, whose own numbers it keeps; "" for
	// everyone else, whose copy carries no free rider's.
	self string
}

// frame is nil when the tick could not be marshalled, remembered so the
// failure is logged once per tick and kind.
func (f *tickFrames) frame(kind frameKind) []byte {
	if b, done := f.built[kind]; done {
		return b
	}
	b := f.marshal(kind, f.tick.Cheers, f.tick.Roadside)
	if f.built == nil {
		f.built = make(map[frameKind][]byte, 8)
	}
	f.built[kind] = b
	return b
}

// marshal is the tick as one kind of socket is sent it, carrying the cheers
// and the roadside given: the room's, or one socket's own cut of them.
func (f *tickFrames) marshal(kind frameKind, cheers []protocol.Cheer, roadside *protocol.RoadsideState) []byte {
	t := *f.tick
	t.Cheers = cheers
	t.Roadside = roadside
	if !kind.workout {
		t.State.WorkoutJSON = ""
	}
	if !kind.scores {
		t.Execution = nil
		if t.Game != nil && t.Game.Race != nil && t.Game.Race.Results != nil {
			game, card := *t.Game, *t.Game.Race
			card.Results = nil
			game.Race = &card
			t.Game = &game
		}
		if t.World != nil && t.World.Racers != nil {
			world := *t.World
			world.Racers = make(map[string]protocol.RaceRider, len(t.World.Racers))
			for id, at := range t.World.Racers {
				at.FinishMs = 0
				world.Racers[id] = at
			}
			t.World = &world
		}
	} else if t.Game != nil && t.Game.Race != nil && unrankedWhy(t.Game.Race.Results) {
		game, card := *t.Game, *t.Game.Race
		card.Results = ownWhy(card.Results, kind.own)
		game.Race = &card
		t.Game = &game
	}
	if !kind.deck {
		t.Jukebox = nil
	}
	t.FreeRoads = onRoad(t.FreeRoads, kind.road)
	if len(f.free) > 0 {
		riders := make(map[string]protocol.RiderMetrics, len(t.Riders))
		for id, m := range t.Riders {
			if _, free := f.free[id]; !free || id == kind.self {
				riders[id] = m
			}
		}
		t.Riders = riders
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
	frames := tickFrames{tick: &out.tick, log: log, channel: rm.channel, free: out.free}
	whys := out.tick.Game != nil && out.tick.Game.Race != nil && unrankedWhy(out.tick.Game.Race.Results)
	for _, c := range out.clients {
		_, scores := out.rode[c.rider.ID]
		scores = scores || out.rode == nil
		own := ""
		if scores && whys {
			own = c.rider.ID
		}
		// Half a tick is worse than none: a frame that did not marshal
		// is skipped, and said so. The workout (#1710) and the deck
		// (#2838) ride only to a socket that has not heard them; a full
		// frame that fails to marshal falls back to the light one and
		// leaves both owed.
		road := out.tick.FreeRoads[c.rider.ID].Road
		self := ""
		if _, free := out.free[c.rider.ID]; free {
			self = c.rider.ID
		}
		light := frameKind{scores: scores, road: road, own: own, self: self}
		kind := frameKind{
			scores:  scores,
			workout: c.workoutSent != out.tick.State.WorkoutHash,
			deck:    c.jukeboxSent != out.tick.JukeboxRev,
			road:    road,
			own:     own,
			self:    self,
		}
		frame := frames.frame(light)
		if frame != nil && kind != light {
			if full := frames.frame(kind); full != nil {
				frame = full
			} else {
				kind = light
			}
		}
		// A cheer or chalk from someone hidden from this rider, or whom
		// they hid, is cut from their copy alone (#3202, #4152). Rare, so
		// the frame is marshalled for them rather than cached for the room.
		// So is a cheer from afar (#3275), which is this rider's alone.
		if frame != nil {
			cheers, cheersCut := rm.cheersFor(c.rider.ID, out.tick.Cheers, out.cheerFrom)
			roadside, chalkCut := rm.roadsideFor(c.rider.ID, out.tick.Roadside)
			afar := out.afar[c]
			if len(afar) > 0 {
				cheers = append(slices.Clip(cheers), afar...)
			}
			if cheersCut || chalkCut || len(afar) > 0 {
				frame = frames.marshal(kind, cheers, roadside)
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

// unrankedWhy reports whether the card tells any racer why they rode unranked.
func unrankedWhy(results []protocol.RaceBracket) bool {
	for _, b := range results {
		for _, f := range b.Unranked {
			if f.Why != "" {
				return true
			}
		}
	}
	return false
}

// ownWhy is the card as rider sees it (ADR-0067): every finisher, and only
// their own why. The tick's brackets are shared, so it copies what it cuts.
func ownWhy(results []protocol.RaceBracket, rider string) []protocol.RaceBracket {
	out := make([]protocol.RaceBracket, len(results))
	for i, b := range results {
		b.Unranked = slices.Clone(b.Unranked)
		for j := range b.Unranked {
			if b.Unranked[j].RiderID != rider {
				b.Unranked[j].Why = ""
			}
		}
		out[i] = b
	}
	return out
}
