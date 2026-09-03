package hub

import (
	"regexp"
	"strconv"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// What a queue entry IS, and what a paste is allowed to turn into one. The
// deck's own behaviour — the playhead, the commands, walking a playlist —
// stays in jukebox.go; this file is the shape of the thing being played.

// A queued playlist holds at most as much as the whole queue does (#615) —
// past fifty it stops being a set somebody chose and starts being a channel
// dump, and the client only resolves that far anyway.
const maxPlaylistTracks = 50

// Tracks across the whole queue, playlists counted by their contents. The
// entry cap alone bounds nothing once one entry can hold fifty videos.
const maxQueuedTracks = 200

var videoIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

// Playlist ids are not one fixed width (PL…, UU…, OL… all differ), so the
// server checks the SHAPE and leaves the vocabulary to the client — the same
// split room icons already use. Refusing endless radio mixes and private
// lists is a message the paster must read, which makes it the client's job.
var playlistIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{2,64}$`)

// isPlaylist: an entry is a playlist exactly when it carries tracks. There is
// no second flag to keep in sync with the list it describes.
func isPlaylist(e protocol.JukeboxEntry) bool { return len(e.Tracks) > 0 }

// newEntry validates one "add" into the entry it earns — a single video, or a
// whole playlist as ONE entry. A playlist taking one queue slot is the point:
// fifty flattened tracks would own the room's fifty and leave the vote order
// describing one rider's taste (#615).
func (j *jukebox) newEntry(cmd protocol.JukeboxCommand, addedBy string) (protocol.JukeboxEntry, bool) {
	if len(j.state.Queue) >= maxQueue {
		return protocol.JukeboxEntry{}, false
	}
	j.nextID++
	entry := protocol.JukeboxEntry{ID: strconv.Itoa(j.nextID), AddedBy: addedBy}

	if len(cmd.Tracks) > 0 {
		if !playlistIDPattern.MatchString(cmd.PlaylistID) ||
			len(cmd.Tracks) > maxPlaylistTracks ||
			j.queuedTracks()+len(cmd.Tracks) > maxQueuedTracks {
			return protocol.JukeboxEntry{}, false
		}
		tracks := make([]protocol.JukeboxTrack, 0, len(cmd.Tracks))
		for _, t := range cmd.Tracks {
			// One bad id fails the paste rather than silently thinning the
			// set — a playlist missing track 7 for no stated reason is the
			// kind of thing nobody ever debugs.
			if !videoIDPattern.MatchString(t.VideoID) {
				return protocol.JukeboxEntry{}, false
			}
			tracks = append(tracks, protocol.JukeboxTrack{VideoID: t.VideoID, Title: clip(t.Title, 200)})
		}
		entry.PlaylistID = cmd.PlaylistID
		entry.PlaylistTitle = clip(cmd.PlaylistTitle, 200)
		entry.Tracks = tracks
		// The deck reads VideoID/Title, never Tracks[Index] — one place
		// answers "what is on the deck", for a playlist as for a video. A
		// ?t= is not carried over: it belongs to the single video somebody
		// pasted, and track four of a set was never the good part of one.
		entry.VideoID, entry.Title = tracks[0].VideoID, tracks[0].Title
		return entry, true
	}

	if !videoIDPattern.MatchString(cmd.VideoID) || j.queuedTracks() >= maxQueuedTracks {
		return protocol.JukeboxEntry{}, false
	}
	entry.VideoID, entry.Title = cmd.VideoID, clip(cmd.Title, 200)
	entry.StartSec = clampSec(cmd.PositionSec)
	return entry, true
}

func clip(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// queuedTracks counts what the queue actually holds — a playlist by its
// contents, everything else as one.
func (j *jukebox) queuedTracks() int {
	n := 0
	for _, entry := range j.state.Queue {
		n += max(len(entry.Tracks), 1)
	}
	return n
}

// leavingEntry: whether the next advance leaves the current entry behind,
// rather than stepping to another track inside it.
func (j *jukebox) leavingEntry() bool {
	cur := j.state.Current
	return cur == nil || cur.Index+1 >= len(cur.Tracks)
}

// trackStart is where the track on the deck begins. A ?t= paste moves the
// whole room to the good part; inside a playlist every track starts at 0.
func (j *jukebox) trackStart() float64 {
	if cur := j.state.Current; cur != nil && !isPlaylist(*cur) {
		return cur.StartSec
	}
	return 0
}

// withIndex is the entry pointed at track i, as a NEW value. Stepping through
// a playlist has to build a fresh entry rather than move the index on the one
// already on the deck: snapshot() hands Current out BY POINTER and the caller
// marshals it outside the room lock, so an entry is immutable the moment it
// reaches the deck (the same rule the Queue clone enforces, audit #219).
// VideoID/Title come along, because they are what every client path reads to
// learn what is playing — which is why a playlist needed no branch in any.
func withIndex(entry protocol.JukeboxEntry, i int) protocol.JukeboxEntry {
	if i < 0 || i >= len(entry.Tracks) {
		return entry
	}
	entry.Index = i
	entry.VideoID, entry.Title = entry.Tracks[i].VideoID, entry.Tracks[i].Title
	// Only the pasted single video carries a ?t=; track four was never the
	// good part of anything.
	entry.StartSec = 0
	return entry
}
