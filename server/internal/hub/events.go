package hub

import (
	"strconv"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// The room timeline's other half (#321): what the room DID, buffered like
// cheers and drained onto the tick. Nothing here is persisted (ADR-0019) —
// the lines are worthless the next day, and the chat history stays clean.

// A queue burst is one line. Filling a party playlist is a paste-fest of a
// few tracks over some seconds, and one line per track pushes the actual
// conversation off the screen — worse since #291 made scrolling back awkward.
const eventBurstWindow = 10 * time.Second

// Bounded like every tick queue; the jukebox's own 300 ms per-rider throttle
// is the real limit, so this only fills if ticks stall.
const maxPendingEvents = 64

// eventLog buffers this second's room events and coalesces a rider's queue
// burst into one growing line. Not goroutine-safe — the room's mutex guards it.
type eventLog struct {
	pending []protocol.RoomEvent
	nextID  int
	// The line a burst is still growing into, and when it last grew. Only
	// the most recent line stays open: anything else happening in the room
	// closes it, so a count never climbs above lines that came after it.
	open   *protocol.RoomEvent
	openAt time.Time
}

// add records one event, growing the open burst instead when this is more of
// the same. A grown line is re-sent under its original id — clients key on it
// and replace the line in place rather than stacking a second one.
func (el *eventLog) add(ev protocol.RoomEvent, now time.Time) {
	if el.open != nil && el.open.Verb == ev.Verb &&
		now.Sub(el.openAt) <= eventBurstWindow && coalesces(*el.open, ev) {
		el.open.Count += ev.Count
		el.open.Track = "" // "Kim queued 3 tracks" — no single title left
		el.openAt = now
		el.resend(*el.open)
		return
	}
	el.nextID++
	ev.ID = strconv.Itoa(el.nextID)
	el.append(ev)
	if bursts(ev.Verb) {
		open := ev
		el.open, el.openAt = &open, now
	} else {
		el.open = nil
	}
}

// Which verbs grow a line instead of starting one.
func bursts(verb string) bool { return verb == "queued" || verb == "joined" }

// Whether `next` belongs on the line `open` already started. A queue burst is
// one rider pasting tracks, so it is the ACTOR that has to match; arrivals are
// the opposite — six people turning up when a planned session opens is exactly
// the burst worth folding, and the line names the first of them ("Ana and 2
// others joined") because six lines push the conversation off the screen.
func coalesces(open, next protocol.RoomEvent) bool {
	if next.Verb == "joined" {
		return true
	}
	return next.Actor == open.Actor
}

// resend replaces the pending copy of a grown line, or queues it again when
// the tick already carried it away.
func (el *eventLog) resend(ev protocol.RoomEvent) {
	for i, pending := range el.pending {
		if pending.ID == ev.ID {
			el.pending[i] = ev
			return
		}
	}
	el.append(ev)
}

func (el *eventLog) append(ev protocol.RoomEvent) {
	if len(el.pending) < maxPendingEvents {
		el.pending = append(el.pending, ev)
	}
}

// drain hands this tick its events and empties the buffer.
func (el *eventLog) drain() []protocol.RoomEvent {
	out := el.pending
	el.pending = nil
	return out
}

// presenceKind labels who came and went (#984, ADR-0022's "Discord join/leave
// shape"). Ephemeral like the rest: a rider arriving is worth a line while
// the room is happening and worth nothing tomorrow, so it rides the tick and
// no table hears about it.
const presenceKind = "presence"

// How long a rider's socket may be gone before the room is told they left.
//
// Not invented: the client's reconnect backoff is `min(1000 * 2^attempts,
// 10s)`, which spends 1+2+4+8 = 15 s trying before it settles into ten-second
// retries. A phone in a garage flaps constantly, and a leave line per flap is
// a strobe rather than a timeline — so a socket that is coming back is back
// inside this, and nothing is said at all.
const presenceGrace = 15 * time.Second

// presenceLine is one rider arriving, leaving, stepping out or coming back.
func presenceLine(verb, actor string, now time.Time) protocol.RoomEvent {
	return protocol.RoomEvent{
		Kind: presenceKind, Verb: verb, Actor: actor,
		Count: 1, At: now.UnixMilli(),
	}
}

// sessionKind labels the lines a room's plan and timeline produce (#359).
// The jukebox changing under everyone was only half of "what happened here":
// a session being planned, moved, started or finished is the other half, and
// riders were reading it nowhere.
const sessionKind = "session"

// sessionLine is one thing that happened to this room's plan or timeline.
// `startsAt` is the zero time on the lines that are about right now.
func sessionLine(verb, actor, workout string, startsAt, now time.Time) protocol.RoomEvent {
	ev := protocol.RoomEvent{
		Kind: sessionKind, Verb: verb, Actor: actor, Subject: workout,
		Count: 1, At: now.UnixMilli(),
	}
	if !startsAt.IsZero() {
		ev.When = startsAt.UnixMilli()
	}
	return ev
}
