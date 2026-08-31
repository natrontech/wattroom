package hub

import (
	"regexp"
	"strconv"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// The queue is a party playlist, not storage — a cap keeps a hostile client
// from growing room memory, and nobody queues fifty songs in good faith.
const maxQueue = 50

// What the room remembers having played (#286). Five is a glance, not a log:
// long enough to put the last good track on again, short enough to stay in
// the tick without paying for a history nobody scrolls.
const maxHistory = 5

// A video longer than six hours is not a party track; the clamp bounds the
// untrusted playhead the same way metrics are bounded.
const maxSeekSec = 6 * 3600

func clampSec(v float64) float64 {
	if v < 0 || v != v { // NaN guards itself
		return 0
	}
	if v > maxSeekSec {
		return maxSeekSec
	}
	return v
}

// eventKind labels every timeline line the deck produces (#321).
const eventKind = "jukebox"

// deckLine is one rider-attributed thing that happened to the queue.
func deckLine(verb, actor, track string, now time.Time) protocol.RoomEvent {
	return protocol.RoomEvent{
		Kind: eventKind, Verb: verb, Actor: actor, Track: track,
		Count: 1, At: now.UnixMilli(),
	}
}

// nowPlaying is the line a track earns by reaching the deck, however it got
// there: skipped into, ended into, or queued onto an empty deck. Nobody's
// name is on it — the deck did this, and QueuedBy credits whoever put the
// track there, however long ago.
func nowPlaying(entry protocol.JukeboxEntry, now time.Time) protocol.RoomEvent {
	return protocol.RoomEvent{
		Kind: eventKind, Verb: "playing", Track: entry.Title,
		QueuedBy: entry.AddedBy, Count: 1, At: now.UnixMilli(),
	}
}

var videoIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

// jukebox is the server's half of the synced player (#23): it owns the queue
// and the playback anchor, and knows nothing about YouTube itself — clients
// report "ended", the server never needs a duration. Position is an anchor,
// not a counter: PositionSec at AnchorMs, so ticks carry truth without the
// server simulating playback.
//
// Not goroutine-safe on its own — the owning room's mutex guards it.
type jukebox struct {
	state protocol.JukeboxState
	// Entry ids are per-room and monotonic: unique is all they must be, and
	// a counter is unique without a random source (which tests would fight).
	nextID int
}

func newJukebox() *jukebox {
	return &jukebox{state: protocol.JukeboxState{
		Queue:   []protocol.JukeboxEntry{},
		History: []protocol.JukeboxEntry{},
	}}
}

// snapshot renders the state at now. The slices are CLONED: the caller
// marshals outside the room lock, and remove() shifts the backing array in
// place — sharing it was a data race (audit #219).
func (j *jukebox) snapshot() protocol.JukeboxState {
	out := j.state
	// Non-nil even when empty — nil marshals as null and the wire type
	// promises an array (crashed clients on room open).
	out.Queue = append(make([]protocol.JukeboxEntry, 0, len(j.state.Queue)), j.state.Queue...)
	out.History = append(make([]protocol.JukeboxEntry, 0, len(j.state.History)), j.state.History...)
	return out
}

// positionAt is the shared playhead at a given instant.
func (j *jukebox) positionAt(now time.Time) float64 {
	if !j.state.Playing {
		return j.state.PositionSec
	}
	return j.state.PositionSec + float64(now.UnixMilli()-j.state.AnchorMs)/1000
}

// apply runs one member command; returns false for junk, plus the room-timeline
// lines the command earned (#321) — the deck knows what happened, the room
// decides who hears about it. Every member may do all of this (docs/SPEC.md
// matrix: jukebox controls default to members). riderID identifies the voter;
// addedBy is the display name entries carry.
func (j *jukebox) apply(cmd protocol.JukeboxCommand, riderID, addedBy string, now time.Time) ([]protocol.RoomEvent, bool) {
	switch cmd.Action {
	case "add":
		if !videoIDPattern.MatchString(cmd.VideoID) || len(j.state.Queue) >= maxQueue {
			return nil, false
		}
		title := cmd.Title
		if len(title) > 200 {
			title = title[:200]
		}
		j.nextID++
		entry := protocol.JukeboxEntry{
			ID: strconv.Itoa(j.nextID), VideoID: cmd.VideoID, Title: title,
			AddedBy: addedBy, StartSec: clampSec(cmd.PositionSec),
		}
		if j.state.Current == nil {
			// An empty deck plays immediately — adding the first song IS
			// pressing play, and one action gets one line: the now-playing
			// one, which names who queued it anyway.
			j.play(entry, now)
			return []protocol.RoomEvent{nowPlaying(entry, now)}, true
		}
		j.state.Queue = append(j.state.Queue, entry)
		return []protocol.RoomEvent{deckLine("queued", addedBy, entry.Title, now)}, true

	case "remove":
		i := j.indexOf(cmd.EntryID)
		if i < 0 {
			return nil, false
		}
		removed := j.state.Queue[i]
		j.state.Queue = append(j.state.Queue[:i], j.state.Queue[i+1:]...)
		return []protocol.RoomEvent{deckLine("removed", addedBy, removed.Title, now)}, true

	case "vote":
		// One vote per rider, toggled — and a vote that lands FLOATS the
		// entry past every lower-voted one ahead of it, which is the whole
		// point of upvoting a party queue.
		i := j.indexOf(cmd.EntryID)
		if i < 0 || riderID == "" {
			return nil, false
		}
		// Rebuilt, never mutated in place: the snapshot clone shares these
		// backing arrays with a marshal running outside the room lock (#219).
		entry := &j.state.Queue[i]
		next := make([]string, 0, len(entry.Voters)+1)
		voted := false
		for _, voter := range entry.Voters {
			if voter == riderID {
				voted = true
				continue
			}
			next = append(next, voter)
		}
		if !voted {
			next = append(next, riderID)
		}
		entry.Voters = next
		if !voted {
			j.float(i)
		}
		return nil, true

	case "move":
		// Hand-reordering wins over vote order until the next vote — the
		// queue slice IS the order, so there is nothing to re-sort.
		from := j.indexOf(cmd.EntryID)
		if from < 0 {
			return nil, false
		}
		to := min(max(cmd.Index, 0), len(j.state.Queue)-1)
		if to == from {
			return nil, false
		}
		next := make([]protocol.JukeboxEntry, 0, len(j.state.Queue))
		for i, entry := range j.state.Queue {
			if i == from {
				continue
			}
			next = append(next, entry)
		}
		next = append(next, protocol.JukeboxEntry{})
		copy(next[to+1:], next[to:])
		next[to] = j.state.Queue[from]
		j.state.Queue = next
		return nil, true

	case "play":
		if j.state.Current == nil || j.state.Playing {
			return nil, false
		}
		j.state.Playing = true
		j.state.AnchorMs = now.UnixMilli()
		return nil, true

	case "pause":
		if j.state.Current == nil || !j.state.Playing {
			return nil, false
		}
		j.state.PositionSec = j.positionAt(now)
		j.state.Playing = false
		return nil, true

	case "seek":
		// Moving the anchor IS the whole feature (#114): clients converge
		// through the same drift-chase play/pause already use. Works paused
		// too — the playhead moves, the deck stays stopped.
		if j.state.Current == nil {
			return nil, false
		}
		j.state.PositionSec = clampSec(cmd.PositionSec)
		j.state.AnchorMs = now.UnixMilli()
		return nil, true

	case "skip":
		if j.state.Current == nil {
			return nil, false
		}
		skipped := *j.state.Current
		j.advance(now)
		events := []protocol.RoomEvent{deckLine("skipped", addedBy, skipped.Title, now)}
		if j.state.Current != nil {
			events = append(events, nowPlaying(*j.state.Current, now))
		}
		return events, true

	case "ended":
		// Every client reports the end; the (video, epoch) pair makes the
		// first report advance and every echo a no-op — a video queued twice
		// used to be eaten by its own echoes (audit #219).
		if j.state.Current == nil || j.state.Current.VideoID != cmd.VideoID ||
			cmd.AnchorMs != j.state.AnchorMs {
			return nil, false
		}
		j.advance(now)
		if j.state.Current == nil {
			return nil, true // the queue ran dry; silence says that already
		}
		return []protocol.RoomEvent{nowPlaying(*j.state.Current, now)}, true

	default:
		return nil, false
	}
}

func (j *jukebox) indexOf(entryID string) int {
	if entryID == "" {
		return -1
	}
	for i, entry := range j.state.Queue {
		if entry.ID == entryID {
			return i
		}
	}
	return -1
}

// float bubbles a freshly-voted entry up past every entry with fewer votes.
func (j *jukebox) float(i int) {
	for i > 0 && len(j.state.Queue[i-1].Voters) < len(j.state.Queue[i].Voters) {
		j.state.Queue[i-1], j.state.Queue[i] = j.state.Queue[i], j.state.Queue[i-1]
		i--
	}
}

func (j *jukebox) play(entry protocol.JukeboxEntry, now time.Time) {
	j.state.Current = &entry
	j.state.Playing = true
	j.state.PositionSec = entry.StartSec
	j.state.AnchorMs = now.UnixMilli()
}

func (j *jukebox) advance(now time.Time) {
	if j.state.Current != nil {
		// Newest first, capped: the deck's memory, not a play log.
		j.state.History = append([]protocol.JukeboxEntry{*j.state.Current}, j.state.History...)
		if len(j.state.History) > maxHistory {
			j.state.History = j.state.History[:maxHistory]
		}
	}
	if len(j.state.Queue) == 0 {
		j.state.Current = nil
		j.state.Playing = false
		j.state.PositionSec = 0
		return
	}
	next := j.state.Queue[0]
	j.state.Queue = j.state.Queue[1:]
	j.play(next, now)
}
