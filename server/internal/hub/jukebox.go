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
	// What the last command did to a POOL track, for the room to record
	// once the lock is released (#269); nil otherwise. Deliberately not
	// folded into finished: that one is the DJ credit — a natural end only,
	// and YouTube counts — where this one is a pool track leaving the deck
	// whether it was played through or skipped past.
	event *trackEvent
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

// trackEvent is one pool track leaving the deck (#269) — the substrate smart
// shuffle weights by. queuedBy is who put it there, NOT who pressed skip:
// "whose track was this" is what a taste model wants (#271), and who did the
// skipping is already a room-timeline line. Empty when autoplay queued it.
type trackEvent struct {
	trackID  string
	videoID  string
	title    string
	queuedBy string
	skipped  bool
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
		return j.onAdd(cmd, riderID, addedBy, now)
	case "remove":
		return j.onRemove(cmd, riderID, addedBy, now)
	case "restore":
		return j.onRestore(cmd, riderID, addedBy, now)
	case "vote":
		return j.onVote(cmd, riderID, addedBy, now)
	case "move":
		return j.onMove(cmd, riderID, addedBy, now)
	case "play":
		return j.onPlay(cmd, riderID, addedBy, now)
	case "pause":
		return j.onPause(cmd, riderID, addedBy, now)
	case "seek":
		return j.onSeek(cmd, riderID, addedBy, now)
	case "skip":
		return j.onSkip(cmd, riderID, addedBy, now)
	case "back":
		return j.onBack(cmd, riderID, addedBy, now)
	case "skipPlaylist":
		return j.onSkipPlaylist(cmd, riderID, addedBy, now)
	case "ended":
		return j.onEnded(cmd, riderID, addedBy, now)
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

// seedHistory fills an empty "just played" with what the database remembers
// (#1432) — a fresh hub after a deploy, the first socket into a room. Only
// while nothing has been played since: a room that has already moved on
// keeps its own memory.
func (j *jukebox) seedHistory(entries []protocol.JukeboxEntry) {
	if len(j.state.History) > 0 || len(entries) == 0 {
		return
	}
	if len(entries) > maxHistory {
		entries = entries[:maxHistory]
	}
	for i := range entries {
		entries[i].ID = "seed-" + strconv.Itoa(i)
		if entries[i].AddedBy == "" {
			entries[i].AddedBy = autoplayActor
		}
	}
	j.state.History = entries
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
