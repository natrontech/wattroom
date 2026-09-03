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

// A queued playlist holds at most as much as the whole queue does (#615) —
// past fifty it stops being a set somebody chose and starts being a channel
// dump, and the client only resolves that far anyway.
const maxPlaylistTracks = 50

// Tracks across the whole queue, playlists counted by their contents. The
// entry cap alone bounds nothing once one entry can hold fifty videos.
const maxQueuedTracks = 200

// How far into a track "back" stops meaning "start this one over" and starts
// meaning "the one before it" — the idiom every music player already taught.
const backRestartSec = 3.0

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

// Playlist ids are not one fixed width (PL…, UU…, OL… all differ), so the
// server checks the SHAPE and leaves the vocabulary to the client — the same
// split room icons already use. Refusing endless radio mixes and private
// lists is a message the paster must read, which makes it the client's job.
var playlistIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{2,64}$`)

// isPlaylist: an entry is a playlist exactly when it carries tracks. There is
// no second flag to keep in sync with the list it describes.
func isPlaylist(e protocol.JukeboxEntry) bool { return len(e.Tracks) > 0 }

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
	// Entry id → rider id of whoever queued it (#467). AddedBy on the wire
	// is a display name; the DJ achievement needs the account. Bounded by
	// the queue plus the deck; an entry leaving takes its owner with it.
	owners map[string]string
	// The track the last command let finish, for the room to credit once
	// the lock is released; nil otherwise.
	finished *playedTrack
}

// playedTrack is a track that reached its natural end (#467): who queued it
// and a ref unique to that play within the room.
type playedTrack struct {
	riderID string
	ref     string
}

func newJukebox() *jukebox {
	return &jukebox{state: protocol.JukeboxState{
		Queue:   []protocol.JukeboxEntry{},
		History: []protocol.JukeboxEntry{},
	}, owners: make(map[string]string)}
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
		entry, ok := j.newEntry(cmd, addedBy)
		if !ok {
			return nil, false
		}
		if riderID != "" {
			j.owners[entry.ID] = riderID
		}
		if j.state.Current == nil {
			// An empty deck plays immediately — adding the first song IS
			// pressing play, and one action gets one line: the now-playing
			// one, which names who queued it anyway.
			j.play(entry, now)
			return []protocol.RoomEvent{nowPlaying(*j.state.Current, now)}, true
		}
		j.state.Queue = append(j.state.Queue, entry)
		if isPlaylist(entry) {
			// A playlist earns one line naming the set, not fifty naming
			// its tracks — the burst rule #321 already applies to adds.
			line := deckLine("queuedPlaylist", addedBy, entry.PlaylistTitle, now)
			line.Count = len(entry.Tracks)
			return []protocol.RoomEvent{line}, true
		}
		return []protocol.RoomEvent{deckLine("queued", addedBy, entry.Title, now)}, true

	case "remove":
		i := j.indexOf(cmd.EntryID)
		if i < 0 {
			return nil, false
		}
		removed := j.state.Queue[i]
		j.state.Queue = append(j.state.Queue[:i], j.state.Queue[i+1:]...)
		delete(j.owners, removed.ID)
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
		// Skipping a track INSIDE a playlist leaves the entry on the deck,
		// so its owner outlives the track — dropping the credit here cost
		// the DJ every track after the first (#467, #615).
		if j.leavingEntry() {
			delete(j.owners, skipped.ID)
		}
		j.advance(now)
		events := []protocol.RoomEvent{deckLine("skipped", addedBy, skipped.Title, now)}
		if j.state.Current != nil {
			events = append(events, nowPlaying(*j.state.Current, now))
		}
		return events, true

	case "back":
		// The idiom every music player already taught: a little way in, back
		// starts this track over; at its start it steps to the one before.
		// Walking a playlist backwards BY HAND is fine — what never repeats
		// is the auto-advance, which only ever moves forward (#615).
		// Outside a playlist there is nothing before the deck, so back
		// always restarts: stepping across queue entries would mean putting
		// history back at the head, which is its own feature.
		if j.state.Current == nil {
			return nil, false
		}
		if j.positionAt(now)-j.trackStart() > backRestartSec || j.state.Current.Index == 0 {
			j.state.PositionSec = j.trackStart()
			j.state.AnchorMs = now.UnixMilli()
			return nil, true
		}
		j.state.Current.Index--
		j.playTrack(now)
		return []protocol.RoomEvent{nowPlaying(*j.state.Current, now)}, true

	case "skipPlaylist":
		// The escape hatch that makes a long playlist safe to queue: one tap
		// drops the rest of it and moves the room on. Every member may —
		// nobody should have to sit through another rider's two hours.
		if j.state.Current == nil || !isPlaylist(*j.state.Current) {
			return nil, false
		}
		skipped := *j.state.Current
		delete(j.owners, skipped.ID)
		j.remember()
		j.advanceEntry(now)
		line := deckLine("skippedPlaylist", addedBy, skipped.PlaylistTitle, now)
		line.Count = len(skipped.Tracks) - skipped.Index - 1
		events := []protocol.RoomEvent{line}
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
		// Played through, not skipped: the DJ's credit (#467). The anchor
		// makes the ref unique to this play of this entry.
		if owner := j.owners[j.state.Current.ID]; owner != "" {
			j.finished = &playedTrack{
				riderID: owner,
				ref:     j.state.Current.ID + "@" + strconv.FormatInt(j.state.AnchorMs, 10),
			}
		}
		// Every track of a playlist played through is its own credit; the
		// owner only leaves when the ENTRY does (#615).
		if j.leavingEntry() {
			delete(j.owners, j.state.Current.ID)
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

// syncTrack points VideoID/Title at the entry's current track. Every client
// path — the loader, the drift chase, the ended epoch, the timeline line —
// reads those two fields, so a playlist needed no branch in any of them.
func (j *jukebox) syncTrack() {
	cur := j.state.Current
	if cur == nil || cur.Index < 0 || cur.Index >= len(cur.Tracks) {
		return
	}
	cur.VideoID, cur.Title = cur.Tracks[cur.Index].VideoID, cur.Tracks[cur.Index].Title
}

func (j *jukebox) play(entry protocol.JukeboxEntry, now time.Time) {
	j.state.Current = &entry
	j.syncTrack()
	j.state.Playing = true
	j.state.PositionSec = entry.StartSec
	j.state.AnchorMs = now.UnixMilli()
}

// playTrack starts the track the index now points at. The fresh anchor is
// also what makes the outgoing track's "ended" echoes no-ops.
func (j *jukebox) playTrack(now time.Time) {
	j.syncTrack()
	j.state.Playing = true
	j.state.PositionSec = 0
	j.state.AnchorMs = now.UnixMilli()
}

// remember puts what the deck just played at the head of the short history.
// TRACKS, never playlists: "just played" is there so somebody can put a song
// on again, and a playlist's name was never a song.
func (j *jukebox) remember() {
	cur := j.state.Current
	if cur == nil {
		return
	}
	played := *cur
	if isPlaylist(*cur) {
		// Unique per PLAY, not per track: stepping back and playing track 4
		// again put a second row under the same id, and the keyed history
		// list threw rather than rendering it. The anchor is what the DJ
		// credit already uses to tell two plays of one entry apart.
		played = protocol.JukeboxEntry{
			ID: cur.ID + "#" + strconv.Itoa(cur.Index) +
				"@" + strconv.FormatInt(j.state.AnchorMs, 10),
			VideoID: cur.VideoID, Title: cur.Title, AddedBy: cur.AddedBy,
		}
	}
	// Newest first, capped: the deck's memory, not a play log.
	j.state.History = append([]protocol.JukeboxEntry{played}, j.state.History...)
	if len(j.state.History) > maxHistory {
		j.state.History = j.state.History[:maxHistory]
	}
}

// advance moves the deck on by one track: to the next track of the playlist
// on the deck if it has one, otherwise to the next queue entry. It only ever
// moves FORWARD — a playlist runs once through and never restarts itself.
func (j *jukebox) advance(now time.Time) {
	j.remember()
	if cur := j.state.Current; cur != nil && cur.Index+1 < len(cur.Tracks) {
		cur.Index++
		j.playTrack(now)
		return
	}
	j.advanceEntry(now)
}

// advanceEntry leaves the current entry behind — a playlist's remaining
// tracks with it — and starts the next thing in the queue.
func (j *jukebox) advanceEntry(now time.Time) {
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
