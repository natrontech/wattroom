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
	if el.open != nil && ev.Verb == "queued" && ev.Actor == el.open.Actor &&
		now.Sub(el.openAt) <= eventBurstWindow {
		el.open.Count += ev.Count
		el.open.Track = "" // "Kim queued 3 tracks" — no single title left
		el.openAt = now
		el.resend(*el.open)
		return
	}
	el.nextID++
	ev.ID = strconv.Itoa(el.nextID)
	el.append(ev)
	if ev.Verb == "queued" {
		open := ev
		el.open, el.openAt = &open, now
	} else {
		el.open = nil
	}
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
