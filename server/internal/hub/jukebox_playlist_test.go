package hub

import (
	"strings"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

func plTracks(n int) []protocol.JukeboxTrack {
	const ids = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
	out := make([]protocol.JukeboxTrack, 0, n)
	for i := range n {
		id := strings.Repeat(string(ids[i%len(ids)]), 11)
		out = append(out, protocol.JukeboxTrack{VideoID: id, Title: "track-" + id[:1]})
	}
	return out
}

func addPlaylist(j *jukebox, n int, at time.Time) bool {
	return accepted(j, protocol.JukeboxCommand{
		Action: "add", PlaylistID: "PLtest", PlaylistTitle: "hard techno",
		Tracks: plTracks(n),
	}, "r-jan", "jan", at)
}

// endCurrent reports the deck's track as finished, against the epoch the
// server is actually holding — what a client does every time a video ends.
func endCurrent(j *jukebox, at time.Time) bool {
	cur := j.snapshot().Current
	if cur == nil {
		return false
	}
	return accepted(j, protocol.JukeboxCommand{
		Action: "ended", VideoID: cur.VideoID, AnchorMs: j.state.AnchorMs,
	}, "r-jan", "jan", at)
}

func TestPlaylistTakesOneQueueSlot(t *testing.T) {
	j := newJukebox()
	add(j, "dQw4w9WgXcQ", jat(0)) // occupies the deck
	if !addPlaylist(j, 12, jat(1)) {
		t.Fatal("playlist add refused")
	}
	s := j.snapshot()
	if len(s.Queue) != 1 {
		t.Fatalf("a 12-track playlist took %d queue slots, want 1", len(s.Queue))
	}
	entry := s.Queue[0]
	if len(entry.Tracks) != 12 || entry.PlaylistTitle != "hard techno" || entry.Index != 0 {
		t.Fatalf("playlist entry not carried whole: %+v", entry)
	}
	// The deck reads VideoID/Title — a playlist answers them from track 0.
	if entry.VideoID != entry.Tracks[0].VideoID || entry.Title != entry.Tracks[0].Title {
		t.Fatalf("entry does not point at its first track: %+v", entry)
	}
}

func TestPlaylistWalksItsTracksThenLeaves(t *testing.T) {
	j := newJukebox()
	addPlaylist(j, 3, jat(0))
	add(j, "dQw4w9WgXcQ", jat(1)) // waits behind the whole playlist
	tracks := plTracks(3)

	for i, want := range tracks[1:] {
		if !endCurrent(j, jat(10+i)) {
			t.Fatalf("track %d end refused", i)
		}
		s := j.snapshot()
		if s.Current.VideoID != want.VideoID || s.Current.Index != i+1 {
			t.Fatalf("step %d landed on %q index %d, want %q", i, s.Current.VideoID, s.Current.Index, want.VideoID)
		}
		if len(s.Queue) != 1 {
			t.Fatal("stepping inside the playlist consumed a queue entry")
		}
	}
	// The last track ending hands over to the queue — it never wraps back
	// to track 0.
	endCurrent(j, jat(20))
	s := j.snapshot()
	if s.Current == nil || s.Current.VideoID != "dQw4w9WgXcQ" {
		t.Fatalf("the spent playlist did not hand over to the queue: %+v", s.Current)
	}
	if len(s.Queue) != 0 {
		t.Fatalf("queue not consumed: %+v", s.Queue)
	}
}

func TestSpentPlaylistOnAnEmptyQueueStopsTheDeck(t *testing.T) {
	j := newJukebox()
	addPlaylist(j, 2, jat(0))
	endCurrent(j, jat(1))
	endCurrent(j, jat(2))
	s := j.snapshot()
	if s.Current != nil || s.Playing {
		t.Fatalf("the playlist restarted instead of ending: %+v", s.Current)
	}
}

func TestSkipMovesInsideThePlaylist(t *testing.T) {
	j := newJukebox()
	addPlaylist(j, 4, jat(0))
	add(j, "dQw4w9WgXcQ", jat(1))

	accepted(j, protocol.JukeboxCommand{Action: "skip"}, "r-jan", "jan", jat(2))
	s := j.snapshot()
	if s.Current.Index != 1 || len(s.Queue) != 1 {
		t.Fatalf("skip left the playlist: index %d, queue %d", s.Current.Index, len(s.Queue))
	}
	// Skipping the playlist drops every remaining track at once.
	accepted(j, protocol.JukeboxCommand{Action: "skipPlaylist"}, "r-jan", "jan", jat(3))
	s = j.snapshot()
	if s.Current == nil || s.Current.VideoID != "dQw4w9WgXcQ" || len(s.Queue) != 0 {
		t.Fatalf("skipPlaylist did not move to the next entry: %+v", s.Current)
	}
	// It is refused when a plain video is on the deck: the button is not
	// rendered there, and a client sending it anyway gets a no-op.
	if accepted(j, protocol.JukeboxCommand{Action: "skipPlaylist"}, "r-jan", "jan", jat(4)) {
		t.Fatal("skipPlaylist accepted on a single video")
	}
}

func TestBackRestartsThenStepsBack(t *testing.T) {
	j := newJukebox()
	addPlaylist(j, 3, jat(0))
	accepted(j, protocol.JukeboxCommand{Action: "skip"}, "r-jan", "jan", jat(1)) // now on track 2

	// Well into the track, back starts it over rather than leaving it.
	accepted(j, protocol.JukeboxCommand{Action: "back"}, "r-jan", "jan", jat(31))
	s := j.snapshot()
	if s.Current.Index != 1 || s.PositionSec != 0 {
		t.Fatalf("back mid-track did not restart it: index %d pos %v", s.Current.Index, s.PositionSec)
	}
	// At its start, back steps to the previous track.
	accepted(j, protocol.JukeboxCommand{Action: "back"}, "r-jan", "jan", jat(32))
	if got := j.snapshot().Current.Index; got != 0 {
		t.Fatalf("back at the start did not step back: index %d", got)
	}
	// Nothing sits before track 0: back restarts it, never wrapping to the
	// end of the playlist and never reaching into the queue.
	accepted(j, protocol.JukeboxCommand{Action: "back"}, "r-jan", "jan", jat(33))
	if got := j.snapshot().Current.Index; got != 0 {
		t.Fatalf("back at track 0 wrapped to %d", got)
	}
}

func TestBackOnASingleVideoReturnsToItsPastedStart(t *testing.T) {
	j := newJukebox()
	accepted(j, protocol.JukeboxCommand{
		Action: "add", VideoID: "dQw4w9WgXcQ", Title: "t", PositionSec: 94,
	}, "r-jan", "jan", jat(0))
	accepted(j, protocol.JukeboxCommand{Action: "back"}, "r-jan", "jan", jat(30))
	if got := j.snapshot().PositionSec; got != 94 {
		t.Fatalf("back landed at %v, want the pasted ?t=94", got)
	}
}

func TestHistoryRemembersTracksNotPlaylists(t *testing.T) {
	j := newJukebox()
	addPlaylist(j, 3, jat(0))
	tracks := plTracks(3)
	accepted(j, protocol.JukeboxCommand{Action: "skip"}, "r-jan", "jan", jat(1))
	accepted(j, protocol.JukeboxCommand{Action: "skip"}, "r-jan", "jan", jat(2))

	h := j.snapshot().History
	if len(h) != 2 {
		t.Fatalf("history holds %d, want the 2 tracks played", len(h))
	}
	if h[0].VideoID != tracks[1].VideoID || h[1].VideoID != tracks[0].VideoID {
		t.Fatalf("history is not the tracks, newest first: %+v", h)
	}
	if h[0].ID == h[1].ID {
		t.Fatalf("two tracks of one playlist share a history id: %q", h[0].ID)
	}
	if len(h[0].Tracks) != 0 {
		t.Fatal("a history row carries the whole playlist with it")
	}
}

// Playing one track of a set twice must not put two history rows under one
// id: the client's history list is keyed by it and threw on the duplicate,
// which a browser found and the table tests had not (#615).
func TestReplayingATrackGetsItsOwnHistoryRow(t *testing.T) {
	j := newJukebox()
	addPlaylist(j, 3, jat(0))
	accepted(j, protocol.JukeboxCommand{Action: "skip"}, "r-jan", "jan", jat(1))
	// Back at the start of track 2 steps to track 1, which then plays again.
	accepted(j, protocol.JukeboxCommand{Action: "back"}, "r-jan", "jan", jat(2))
	accepted(j, protocol.JukeboxCommand{Action: "skip"}, "r-jan", "jan", jat(3))

	h := j.snapshot().History
	seen := map[string]bool{}
	for _, entry := range h {
		if seen[entry.ID] {
			t.Fatalf("two history rows share the id %q: %+v", entry.ID, h)
		}
		seen[entry.ID] = true
	}
	if len(h) != 2 || h[0].VideoID != h[1].VideoID {
		t.Fatalf("the same track played twice is not two rows of it: %+v", h)
	}
}

// Every track played through is its own credit — the owner leaves with the
// entry, not with the first track of it (#467).
func TestEveryPlaylistTrackCreditsTheRiderWhoQueuedIt(t *testing.T) {
	j := newJukebox()
	addPlaylist(j, 3, jat(0))
	for i := range 3 {
		endCurrent(j, jat(10+i))
		if j.finished == nil || j.finished.riderID != "r-jan" {
			t.Fatalf("track %d played through uncredited: %+v", i, j.finished)
		}
		j.finished = nil // the room drains it each command
	}
}

func TestPlaylistCapsAreEnforced(t *testing.T) {
	j := newJukebox()
	if addPlaylist(j, maxPlaylistTracks+1, jat(0)) {
		t.Fatal("an over-long playlist was accepted")
	}
	// One bad id fails the whole paste rather than silently thinning the set.
	bad := plTracks(3)
	bad[1].VideoID = "nope"
	if accepted(j, protocol.JukeboxCommand{
		Action: "add", PlaylistID: "PLtest", Tracks: bad,
	}, "r-jan", "jan", jat(1)) {
		t.Fatal("a playlist with a junk video id was accepted")
	}
	if accepted(j, protocol.JukeboxCommand{
		Action: "add", PlaylistID: "", Tracks: plTracks(2),
	}, "r-jan", "jan", jat(2)) {
		t.Fatal("a playlist with no id was accepted")
	}
	// The total-track cap bounds what the entry cap alone cannot: fifty
	// entries of fifty tracks each.
	for range maxQueuedTracks/maxPlaylistTracks + 2 {
		addPlaylist(j, maxPlaylistTracks, jat(3))
	}
	if got := j.queuedTracks(); got > maxQueuedTracks {
		t.Fatalf("queue holds %d tracks, over the %d cap", got, maxQueuedTracks)
	}
}
