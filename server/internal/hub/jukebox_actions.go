// One method per jukebox command, dispatched from applyWithRefusal: what
// each verb does to the deck, the queue and the history, and the room event
// it earns. Everything here runs under the room lock, like the switch it
// was.
package hub

import (
	"strconv"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// onAdd is the "add" command.
func (j *jukebox) onAdd(cmd protocol.JukeboxCommand, riderID, addedBy string, now time.Time) ([]protocol.RoomEvent, bool, jukeboxRefusal) {
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
}

// onRemove is the "remove" command.
func (j *jukebox) onRemove(cmd protocol.JukeboxCommand, riderID, addedBy string, now time.Time) ([]protocol.RoomEvent, bool, jukeboxRefusal) {
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
}

// onRestore is the "restore" command.
func (j *jukebox) onRestore(cmd protocol.JukeboxCommand, riderID, addedBy string, now time.Time) ([]protocol.RoomEvent, bool, jukeboxRefusal) {
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
}

// onVote is the "vote" command.
func (j *jukebox) onVote(cmd protocol.JukeboxCommand, riderID, addedBy string, now time.Time) ([]protocol.RoomEvent, bool, jukeboxRefusal) {
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
}

// onMove is the "move" command.
func (j *jukebox) onMove(cmd protocol.JukeboxCommand, riderID, addedBy string, now time.Time) ([]protocol.RoomEvent, bool, jukeboxRefusal) {
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
}

// onPlay is the "play" command.
func (j *jukebox) onPlay(cmd protocol.JukeboxCommand, riderID, addedBy string, now time.Time) ([]protocol.RoomEvent, bool, jukeboxRefusal) {
	if j.state.Current == nil || j.state.Playing {
		return nil, false, ""
	}
	j.state.Playing = true
	j.state.AnchorMs = now.UnixMilli()
	return nil, true, ""
}

// onPause is the "pause" command.
func (j *jukebox) onPause(cmd protocol.JukeboxCommand, riderID, addedBy string, now time.Time) ([]protocol.RoomEvent, bool, jukeboxRefusal) {
	if j.state.Current == nil || !j.state.Playing {
		return nil, false, ""
	}
	j.state.PositionSec = j.positionAt(now)
	j.state.Playing = false
	return nil, true, ""
}

// onSeek is the "seek" command.
func (j *jukebox) onSeek(cmd protocol.JukeboxCommand, riderID, addedBy string, now time.Time) ([]protocol.RoomEvent, bool, jukeboxRefusal) {
	// Moving the anchor IS the whole feature (#114): clients converge
	// through the same drift-chase play/pause already use. Works paused
	// too — the playhead moves, the deck stays stopped.
	if j.state.Current == nil {
		return nil, false, ""
	}
	j.state.PositionSec = clampSec(cmd.PositionSec)
	j.state.AnchorMs = now.UnixMilli()
	return nil, true, ""
}

// onSkip is the "skip" command.
func (j *jukebox) onSkip(cmd protocol.JukeboxCommand, riderID, addedBy string, now time.Time) ([]protocol.RoomEvent, bool, jukeboxRefusal) {
	if j.state.Current == nil {
		return nil, false, ""
	}
	skipped := *j.state.Current
	if skipped.TrackID != "" {
		j.event = &trackEvent{trackID: skipped.TrackID, queuedBy: j.owners[skipped.ID], skipped: true}
	}
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
}

// onBack is the "back" command.
func (j *jukebox) onBack(cmd protocol.JukeboxCommand, riderID, addedBy string, now time.Time) ([]protocol.RoomEvent, bool, jukeboxRefusal) {
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
}

// onSkipPlaylist is the "skipPlaylist" command.
func (j *jukebox) onSkipPlaylist(cmd protocol.JukeboxCommand, riderID, addedBy string, now time.Time) ([]protocol.RoomEvent, bool, jukeboxRefusal) {
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
}

// onEnded is the "ended" command.
func (j *jukebox) onEnded(cmd protocol.JukeboxCommand, riderID, addedBy string, now time.Time) ([]protocol.RoomEvent, bool, jukeboxRefusal) {
	// Every client reports the end; the (video, epoch) pair makes the
	// first report advance and every echo a no-op — a video queued twice
	// used to be eaten by its own echoes (audit #219).
	// A pool track carries no video id (#267), so matching on VideoID
	// alone would compare "" to "" and pass by accident. Both ids are
	// checked: whichever one identifies the entry has to agree.
	if j.state.Current == nil || j.state.Current.VideoID != cmd.VideoID ||
		j.state.Current.TrackID != cmd.TrackID ||
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
	if j.state.Current.TrackID != "" {
		j.event = &trackEvent{
			trackID: j.state.Current.TrackID, queuedBy: j.owners[j.state.Current.ID],
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
}
