package hub

import (
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

// undoWindow is how long the deck remembers what remove/skipPlaylist just
// dropped, so the acting client's toast can offer a genuine undo (#660) —
// errors.md prefers undo over confirm for anything reversible, and the
// server still holds the entry it just let go of.
const undoWindow = 10 * time.Second

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
	// Set when the last command ran the deck dry (#676), for the room to
	// hand to autoplay once the lock is released; the room clears it.
	idled bool
	// What remove/skipPlaylist last dropped, kept for undoWindow so a
	// "restore" can put it back (#660); nil once restored, expired, or
	// superseded by a newer drop. Only the latest survives — undoing an undo
	// is not a feature riders asked for, and a stack would outlive the toast
	// that offers it anyway.
	pending *pendingUndo
}

// pendingUndo is one dropped entry, plus what "restore" needs to put it back
// exactly where it left off.
type pendingUndo struct {
	entry     protocol.JukeboxEntry
	ownerID   string // restores j.owners; "" when nobody queued it
	expiresAt time.Time

	// Set only when the drop was a queue entry (remove): its slot.
	fromQueue  bool
	queueIndex int

	// Set only when the drop was the deck itself (skipPlaylist): what it was
	// doing, so restore resumes rather than restarts.
	positionSec float64
	wasPlaying  bool
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
//
// Current is NOT cloned: it goes out by pointer, which is safe only because
// an entry never changes once it reaches the deck. Walking a playlist builds
// a new entry (withIndex) rather than moving the index on the published one.
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

// apply keeps the deck's existing test and internal-call shape for commands
// whose rejection is intentionally quiet. The hub uses applyWithRefusal for
// rider-visible add failures.
func (j *jukebox) apply(cmd protocol.JukeboxCommand, riderID, addedBy string, now time.Time) ([]protocol.RoomEvent, bool) {
	events, ok, _ := j.applyWithRefusal(cmd, riderID, addedBy, now)
	return events, ok
}

// applyWithRefusal runs one member command; returns false for junk, plus the
// room-timeline lines the command earned (#321) and a reason for rider-visible
// add failures. The deck knows what happened, the room decides who hears
// about it. Every member may do all of this (docs/SPEC.md matrix: jukebox
// controls default to members). riderID identifies the voter; addedBy is the
// display name entries carry.
func (j *jukebox) applyWithRefusal(cmd protocol.JukeboxCommand, riderID, addedBy string, now time.Time) ([]protocol.RoomEvent, bool, jukeboxRefusal) {
	switch cmd.Action {
	case "add":
		entry, ok, refusal := j.newEntry(cmd, addedBy)
		if !ok {
			return nil, false, refusal
		}
		if riderID != "" {
			j.owners[entry.ID] = riderID
		}
		if j.state.Current == nil {
			// An empty deck plays immediately — adding the first song IS
			// pressing play, and one action gets one line: the now-playing
			// one, which names who queued it anyway.
			j.play(entry, now)
			return []protocol.RoomEvent{nowPlaying(*j.state.Current, now)}, true, ""
		}
		j.state.Queue = append(j.state.Queue, entry)
		if isPlaylist(entry) {
			// A playlist earns one line naming the set, not fifty naming
			// its tracks — the burst rule #321 already applies to adds.
			line := deckLine("queuedPlaylist", addedBy, entry.PlaylistTitle, now)
			line.Count = len(entry.Tracks)
			return []protocol.RoomEvent{line}, true, ""
		}
		return []protocol.RoomEvent{deckLine("queued", addedBy, entry.Title, now)}, true, ""

	case "remove":
		i := j.indexOf(cmd.EntryID)
		if i < 0 {
			return nil, false, ""
		}
		removed := j.state.Queue[i]
		owner := j.owners[removed.ID]
		j.state.Queue = append(j.state.Queue[:i], j.state.Queue[i+1:]...)
		delete(j.owners, removed.ID)
		j.pending = &pendingUndo{
			entry: removed, ownerID: owner, fromQueue: true, queueIndex: i,
			expiresAt: now.Add(undoWindow),
		}
		return []protocol.RoomEvent{deckLine("removed", addedBy, removed.Title, now)}, true, ""

	case "restore":
		// Puts back exactly what remove/skipPlaylist last dropped, within the
		// grace window — the toast's undo button, and nothing else reaches
		// this action. A stale or already-used pending is a no-op, not an
		// error: the toast may have raced its own timeout.
		p := j.pending
		j.pending = nil
		if p == nil || now.After(p.expiresAt) {
			return nil, false, ""
		}
		if p.fromQueue {
			i := min(p.queueIndex, len(j.state.Queue))
			next := make([]protocol.JukeboxEntry, 0, len(j.state.Queue)+1)
			next = append(next, j.state.Queue[:i]...)
			next = append(next, p.entry)
			next = append(next, j.state.Queue[i:]...)
			j.state.Queue = next
			if p.ownerID != "" {
				j.owners[p.entry.ID] = p.ownerID
			}
			return []protocol.RoomEvent{deckLine("restored", addedBy, p.entry.Title, now)}, true, ""
		}
		// A skipped playlist: give the deck back what it was doing, and put
		// whatever took its place at the front of the queue rather than
		// discarding it — the room only moved on a few seconds ago.
		if j.state.Current != nil {
			j.state.Queue = append([]protocol.JukeboxEntry{*j.state.Current}, j.state.Queue...)
		}
		restored := p.entry
		j.state.Current = &restored
		j.state.Playing = p.wasPlaying
		j.state.PositionSec = p.positionSec
		j.state.AnchorMs = now.UnixMilli()
		if p.ownerID != "" {
			j.owners[restored.ID] = p.ownerID
		}
		// Undoes the remember() the skip earned — the playlist did not
		// actually finish, so it should not sit in "just played".
		if len(j.state.History) > 0 {
			j.state.History = j.state.History[1:]
		}
		return []protocol.RoomEvent{deckLine("restored", addedBy, restored.PlaylistTitle, now)}, true, ""

	case "vote":
		// One vote per rider, toggled — and a vote that lands FLOATS the
		// entry past every lower-voted one ahead of it, which is the whole
		// point of upvoting a party queue.
		i := j.indexOf(cmd.EntryID)
		if i < 0 || riderID == "" {
			return nil, false, ""
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
		return nil, true, ""

	case "move":
		// Hand-reordering wins over vote order until the next vote — the
		// queue slice IS the order, so there is nothing to re-sort.
		from := j.indexOf(cmd.EntryID)
		if from < 0 {
			return nil, false, ""
		}
		to := min(max(cmd.Index, 0), len(j.state.Queue)-1)
		if to == from {
			return nil, false, ""
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
		return nil, true, ""

	case "play":
		if j.state.Current == nil || j.state.Playing {
			return nil, false, ""
		}
		j.state.Playing = true
		j.state.AnchorMs = now.UnixMilli()
		return nil, true, ""

	case "pause":
		if j.state.Current == nil || !j.state.Playing {
			return nil, false, ""
		}
		j.state.PositionSec = j.positionAt(now)
		j.state.Playing = false
		return nil, true, ""

	case "seek":
		// Moving the anchor IS the whole feature (#114): clients converge
		// through the same drift-chase play/pause already use. Works paused
		// too — the playhead moves, the deck stays stopped.
		if j.state.Current == nil {
			return nil, false, ""
		}
		j.state.PositionSec = clampSec(cmd.PositionSec)
		j.state.AnchorMs = now.UnixMilli()
		return nil, true, ""

	case "skip":
		if j.state.Current == nil {
			return nil, false, ""
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
		return events, true, ""

	case "back":
		// The idiom every music player already taught: a little way in, back
		// starts this track over; at its start it steps to the one before.
		// Walking a playlist backwards BY HAND is fine — what never repeats
		// is the auto-advance, which only ever moves forward (#615).
		// Outside a playlist there is nothing before the deck, so back
		// always restarts: stepping across queue entries would mean putting
		// history back at the head, which is its own feature.
		if j.state.Current == nil {
			return nil, false, ""
		}
		if j.positionAt(now)-j.trackStart() > backRestartSec || j.state.Current.Index == 0 {
			j.state.PositionSec = j.trackStart()
			j.state.AnchorMs = now.UnixMilli()
			return nil, true, ""
		}
		j.play(withIndex(*j.state.Current, j.state.Current.Index-1), now)
		return []protocol.RoomEvent{nowPlaying(*j.state.Current, now)}, true, ""

	case "skipPlaylist":
		// The escape hatch that makes a long playlist safe to queue: one tap
		// drops the rest of it and moves the room on. Every member may —
		// nobody should have to sit through another rider's two hours.
		if j.state.Current == nil || !isPlaylist(*j.state.Current) {
			return nil, false, ""
		}
		skipped := *j.state.Current
		owner := j.owners[skipped.ID]
		delete(j.owners, skipped.ID)
		j.pending = &pendingUndo{
			entry: skipped, ownerID: owner,
			positionSec: j.positionAt(now), wasPlaying: j.state.Playing,
			expiresAt: now.Add(undoWindow),
		}
		j.remember()
		j.advanceEntry(now)
		line := deckLine("skippedPlaylist", addedBy, skipped.PlaylistTitle, now)
		line.Count = len(skipped.Tracks) - skipped.Index - 1
		events := []protocol.RoomEvent{line}
		if j.state.Current != nil {
			events = append(events, nowPlaying(*j.state.Current, now))
		}
		return events, true, ""

	case "ended":
		// Every client reports the end; the (video, epoch) pair makes the
		// first report advance and every echo a no-op — a video queued twice
		// used to be eaten by its own echoes (audit #219).
		if j.state.Current == nil || j.state.Current.VideoID != cmd.VideoID ||
			cmd.AnchorMs != j.state.AnchorMs {
			return nil, false, ""
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
			return nil, true, "" // the queue ran dry; silence says that already
		}
		return []protocol.RoomEvent{nowPlaying(*j.state.Current, now)}, true, ""

	default:
		return nil, false, ""
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
	if len(entry.Tracks) > 0 {
		entry = withIndex(entry, entry.Index)
	}
	j.state.Current = &entry
	j.state.Playing = true
	j.state.PositionSec = entry.StartSec
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
// moves FORWARD — a playlist runs once through and never restarts itself;
// looping is autoplay's job (#676), and it lives in the room, not here.
func (j *jukebox) advance(now time.Time) {
	j.remember()
	if cur := j.state.Current; cur != nil && cur.Index+1 < len(cur.Tracks) {
		j.play(withIndex(*cur, cur.Index+1), now)
		return
	}
	j.advanceEntry(now)
}

// advanceEntry leaves the current entry behind — a playlist's remaining
// tracks with it — and starts the next thing in the queue. An empty queue
// leaves the deck idle and flags it, so the room can ask autoplay to refill.
func (j *jukebox) advanceEntry(now time.Time) {
	if len(j.state.Queue) == 0 {
		j.state.Current = nil
		j.state.Playing = false
		j.state.PositionSec = 0
		j.idled = true
		return
	}
	next := j.state.Queue[0]
	j.state.Queue = j.state.Queue[1:]
	j.play(next, now)
}
