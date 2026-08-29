package hub

import (
	"regexp"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// The queue is a party playlist, not storage — a cap keeps a hostile client
// from growing room memory, and nobody queues fifty songs in good faith.
const maxQueue = 50

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
}

func newJukebox() *jukebox {
	return &jukebox{state: protocol.JukeboxState{Queue: []protocol.JukeboxEntry{}}}
}

// snapshot renders the state at now.
func (j *jukebox) snapshot() protocol.JukeboxState {
	return j.state
}

// positionAt is the shared playhead at a given instant.
func (j *jukebox) positionAt(now time.Time) float64 {
	if !j.state.Playing {
		return j.state.PositionSec
	}
	return j.state.PositionSec + float64(now.UnixMilli()-j.state.AnchorMs)/1000
}

// apply runs one member command; returns false for junk. Every member may do
// all of this (docs/SPEC.md matrix: jukebox controls default to members).
func (j *jukebox) apply(cmd protocol.JukeboxCommand, addedBy string, now time.Time) bool {
	switch cmd.Action {
	case "add":
		if !videoIDPattern.MatchString(cmd.VideoID) || len(j.state.Queue) >= maxQueue {
			return false
		}
		title := cmd.Title
		if len(title) > 200 {
			title = title[:200]
		}
		entry := protocol.JukeboxEntry{VideoID: cmd.VideoID, Title: title, AddedBy: addedBy}
		if j.state.Current == nil {
			// An empty deck plays immediately — adding the first song IS pressing play.
			j.play(entry, now)
			return true
		}
		j.state.Queue = append(j.state.Queue, entry)
		return true

	case "remove":
		for i, entry := range j.state.Queue {
			if entry.VideoID == cmd.VideoID {
				j.state.Queue = append(j.state.Queue[:i], j.state.Queue[i+1:]...)
				return true
			}
		}
		return false

	case "play":
		if j.state.Current == nil || j.state.Playing {
			return false
		}
		j.state.Playing = true
		j.state.AnchorMs = now.UnixMilli()
		return true

	case "pause":
		if j.state.Current == nil || !j.state.Playing {
			return false
		}
		j.state.PositionSec = j.positionAt(now)
		j.state.Playing = false
		return true

	case "skip":
		if j.state.Current == nil {
			return false
		}
		j.advance(now)
		return true

	case "ended":
		// Every client reports the end; only the first report for the CURRENT
		// video advances — the rest are the same event echoing back.
		if j.state.Current == nil || j.state.Current.VideoID != cmd.VideoID {
			return false
		}
		j.advance(now)
		return true

	default:
		return false
	}
}

func (j *jukebox) play(entry protocol.JukeboxEntry, now time.Time) {
	j.state.Current = &entry
	j.state.Playing = true
	j.state.PositionSec = 0
	j.state.AnchorMs = now.UnixMilli()
}

func (j *jukebox) advance(now time.Time) {
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
