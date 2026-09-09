package hub

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

func jat(sec int) time.Time { return time.Unix(2_000_000+int64(sec), 0) }

// accepted runs one command and keeps only the verdict — the timeline lines
// it also produces (#321) have their own tests below.
func accepted(j *jukebox, cmd protocol.JukeboxCommand, riderID, name string, at time.Time) bool {
	_, ok := j.apply(cmd, riderID, name, at)
	return ok
}

func add(j *jukebox, id string, at time.Time) bool {
	return accepted(j, protocol.JukeboxCommand{Action: "add", VideoID: id, Title: "t-" + id}, "r-jan", "jan", at)
}

func TestAddPlaysAnEmptyDeck(t *testing.T) {
	j := newJukebox()
	if !add(j, "dQw4w9WgXcQ", jat(0)) {
		t.Fatal("add refused")
	}
	s := j.snapshot()
	if s.Current == nil || !s.Playing || s.Current.VideoID != "dQw4w9WgXcQ" || len(s.Queue) != 0 {
		t.Fatalf("first add did not start playback: %+v", s)
	}
	// Second add queues behind it.
	add(j, "abcdefghijk", jat(1))
	if len(j.snapshot().Queue) != 1 {
		t.Fatalf("second add did not queue")
	}
}

func TestSnapshotQueueMarshalsAsArrayNotNull(t *testing.T) {
	// Regression: the race-fix clone (append to nil) returned a nil slice for
	// an empty queue, marshaling "queue":null and crashing every client.
	b, err := json.Marshal(newJukebox().snapshot())
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"queue":[]`, `"history":[]`} {
		if !strings.Contains(string(b), want) {
			t.Fatalf("empty %s must marshal as []: %s", want, b)
		}
	}
}

func TestAnchorSurvivesPause(t *testing.T) {
	j := newJukebox()
	add(j, "dQw4w9WgXcQ", jat(0))
	if got := j.positionAt(jat(30)); got != 30 {
		t.Fatalf("playhead: %v", got)
	}
	accepted(j, protocol.JukeboxCommand{Action: "pause"}, "r-jan", "jan", jat(30))
	if got := j.positionAt(jat(90)); got != 30 {
		t.Fatalf("paused playhead moved: %v", got)
	}
	accepted(j, protocol.JukeboxCommand{Action: "play"}, "r-jan", "jan", jat(90))
	if got := j.positionAt(jat(100)); got != 40 {
		t.Fatalf("resumed playhead: %v", got)
	}
}

func TestEndedAdvancesExactlyOnce(t *testing.T) {
	// Every client reports the end with the anchor it was playing against;
	// the (video, epoch) pair makes the first advance and every echo a no-op
	// — even when the SAME video is queued twice (audit #219).
	j := newJukebox()
	add(j, "dQw4w9WgXcQ", jat(0))
	add(j, "dQw4w9WgXcQ", jat(1)) // the duplicate the old dedupe ate
	add(j, "abcdefghijk", jat(2))
	epoch := j.snapshot().AnchorMs
	for i := 0; i < 5; i++ {
		accepted(j, protocol.JukeboxCommand{Action: "ended", VideoID: "dQw4w9WgXcQ", AnchorMs: epoch}, "r-jan", "jan", jat(200))
	}
	s := j.snapshot()
	if s.Current == nil || s.Current.VideoID != "dQw4w9WgXcQ" || len(s.Queue) != 1 {
		t.Fatalf("echoed ended double-advanced past the duplicate: %+v", s)
	}
	// A report without the current epoch is an echo from a past life — no-op.
	if accepted(j, protocol.JukeboxCommand{Action: "ended", VideoID: "dQw4w9WgXcQ", AnchorMs: epoch}, "r-jan", "jan", jat(300)) {
		t.Fatal("stale-epoch ended accepted")
	}
	// The real second play ends with ITS epoch, then the deck runs dry.
	epoch2 := j.snapshot().AnchorMs
	accepted(j, protocol.JukeboxCommand{Action: "ended", VideoID: "dQw4w9WgXcQ", AnchorMs: epoch2}, "r-jan", "jan", jat(400))
	epoch3 := j.snapshot().AnchorMs
	accepted(j, protocol.JukeboxCommand{Action: "ended", VideoID: "abcdefghijk", AnchorMs: epoch3}, "r-jan", "jan", jat(500))
	if s := j.snapshot(); s.Current != nil || s.Playing {
		t.Fatalf("dry deck still playing: %+v", s)
	}
}

func TestJunkRefused(t *testing.T) {
	j := newJukebox()
	if accepted(j, protocol.JukeboxCommand{Action: "add", VideoID: "'; drop--"}, "r-x", "x", jat(0)) {
		t.Fatal("junk video id accepted")
	}
	add(j, "dQw4w9WgXcQ", jat(0))
	for i := 0; i < maxQueue+10; i++ {
		add(j, "abcdefghijk", jat(i))
	}
	if len(j.snapshot().Queue) > maxQueue {
		t.Fatalf("queue grew past the cap: %d", len(j.snapshot().Queue))
	}
}

func TestAddRefusalExplainsWhyTheDeckRejectedIt(t *testing.T) {
	j := newJukebox()
	if _, ok, reason := j.applyWithRefusal(protocol.JukeboxCommand{Action: "add", VideoID: "not-a-video!"}, "r-x", "x", jat(0)); ok || reason != refusalInvalidVideo {
		t.Fatalf("invalid video: ok=%v reason=%q", ok, reason)
	}
	add(j, "dQw4w9WgXcQ", jat(0))
	for i := 0; i < maxQueue; i++ {
		add(j, "abcdefghijk", jat(i+1))
	}
	if _, ok, reason := j.applyWithRefusal(protocol.JukeboxCommand{Action: "add", VideoID: "ABCDEFGHIJK"}, "r-x", "x", jat(100)); ok || reason != refusalQueueFull {
		t.Fatalf("full queue: ok=%v reason=%q", ok, reason)
	}
}

func TestRemoveTakesTheEntryNotTheVideo(t *testing.T) {
	// The same track queued twice is two entries; removing the second must
	// not take the first (#286 — the old remove matched on videoId).
	j := newJukebox()
	add(j, "dQw4w9WgXcQ", jat(0)) // straight to the deck
	add(j, "abcdefghijk", jat(1))
	add(j, "abcdefghijk", jat(2))
	second := j.snapshot().Queue[1].ID
	if !accepted(j, protocol.JukeboxCommand{Action: "remove", EntryID: second}, "r-jan", "jan", jat(3)) {
		t.Fatal("remove refused")
	}
	q := j.snapshot().Queue
	if len(q) != 1 || q[0].ID == second {
		t.Fatalf("removed the wrong entry: %+v", q)
	}
	if accepted(j, protocol.JukeboxCommand{Action: "remove", EntryID: "nope"}, "r-jan", "jan", jat(4)) {
		t.Fatal("remove of an unknown entry accepted")
	}
}

func TestRestoreUndoesARemoval(t *testing.T) {
	j := newJukebox()
	add(j, "dQw4w9WgXcQ", jat(0)) // deck
	add(j, "aaaaaaaaaaa", jat(1))
	add(j, "bbbbbbbbbbb", jat(2)) // the one we'll drop and undo
	add(j, "ccccccccccc", jat(3))
	before := j.snapshot().Queue
	dropped := before[1] // "bbb..." at slot 1

	if !accepted(j, protocol.JukeboxCommand{Action: "remove", EntryID: dropped.ID}, "r-jan", "jan", jat(4)) {
		t.Fatal("remove refused")
	}
	if len(j.snapshot().Queue) != 2 {
		t.Fatalf("remove did not shrink the queue: %+v", j.snapshot().Queue)
	}

	if !accepted(j, protocol.JukeboxCommand{Action: "restore"}, "r-jan", "jan", jat(5)) {
		t.Fatal("restore refused within the grace window")
	}
	after := j.snapshot().Queue
	if len(after) != len(before) {
		t.Fatalf("restore left the queue at %d entries, want %d", len(after), len(before))
	}
	if after[1].ID != dropped.ID {
		t.Fatalf("restore did not put the entry back at its old slot: %+v", after)
	}

	// The pending drop is consumed — a second restore has nothing to redo.
	if accepted(j, protocol.JukeboxCommand{Action: "restore"}, "r-jan", "jan", jat(6)) {
		t.Fatal("restore accepted with nothing pending")
	}
}

func TestRestoreExpiresAfterTheGraceWindow(t *testing.T) {
	j := newJukebox()
	add(j, "dQw4w9WgXcQ", jat(0))
	add(j, "aaaaaaaaaaa", jat(1))
	entryID := j.snapshot().Queue[0].ID

	accepted(j, protocol.JukeboxCommand{Action: "remove", EntryID: entryID}, "r-jan", "jan", jat(2))
	if accepted(j, protocol.JukeboxCommand{Action: "restore"}, "r-jan", "jan", jat(2+int(undoWindow/time.Second)+1)) {
		t.Fatal("restore accepted after its grace window closed")
	}
}

func TestRemoveDropIsSupersededByTheNextOne(t *testing.T) {
	// Only the latest drop is undoable — a second remove while the first
	// toast is still up must not let a later restore resurrect the first.
	j := newJukebox()
	add(j, "dQw4w9WgXcQ", jat(0))
	add(j, "aaaaaaaaaaa", jat(1))
	add(j, "bbbbbbbbbbb", jat(2))
	q := j.snapshot().Queue
	first, second := q[0].ID, q[1].ID

	accepted(j, protocol.JukeboxCommand{Action: "remove", EntryID: first}, "r-jan", "jan", jat(3))
	accepted(j, protocol.JukeboxCommand{Action: "remove", EntryID: second}, "r-jan", "jan", jat(4))
	accepted(j, protocol.JukeboxCommand{Action: "restore"}, "r-jan", "jan", jat(5))

	ids := map[string]bool{}
	for _, e := range j.snapshot().Queue {
		ids[e.ID] = true
	}
	if !ids[second] {
		t.Fatal("restore did not bring back the most recent drop")
	}
	if ids[first] {
		t.Fatal("restore resurrected a superseded drop")
	}
}

func TestVotesFloatAndToggle(t *testing.T) {
	j := newJukebox()
	add(j, "dQw4w9WgXcQ", jat(0)) // deck
	for _, id := range []string{"aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"} {
		add(j, id, jat(1))
	}
	third := j.snapshot().Queue[2].ID
	// One vote floats it past both unvoted entries ahead of it.
	if !accepted(j, protocol.JukeboxCommand{Action: "vote", EntryID: third}, "r-jan", "jan", jat(2)) {
		t.Fatal("vote refused")
	}
	if got := j.snapshot().Queue[0]; got.ID != third || len(got.Voters) != 1 {
		t.Fatalf("vote did not float the entry: %+v", j.snapshot().Queue)
	}
	// A second rider adds to it; the same rider twice is a toggle, not a stack.
	accepted(j, protocol.JukeboxCommand{Action: "vote", EntryID: third}, "r-ada", "ada", jat(3))
	accepted(j, protocol.JukeboxCommand{Action: "vote", EntryID: third}, "r-ada", "ada", jat(4))
	if got := len(j.snapshot().Queue[0].Voters); got != 1 {
		t.Fatalf("toggle left %d voters", got)
	}
	// Anonymous votes (no rider id) have nothing to toggle — refused.
	if accepted(j, protocol.JukeboxCommand{Action: "vote", EntryID: third}, "", "", jat(5)) {
		t.Fatal("vote without a rider id accepted")
	}
}

func TestMoveReordersAndClamps(t *testing.T) {
	j := newJukebox()
	add(j, "dQw4w9WgXcQ", jat(0)) // deck
	for _, id := range []string{"aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"} {
		add(j, id, jat(1))
	}
	last := j.snapshot().Queue[2].ID
	if !accepted(j, protocol.JukeboxCommand{Action: "move", EntryID: last, Index: 0}, "r-jan", "jan", jat(2)) {
		t.Fatal("move refused")
	}
	q := j.snapshot().Queue
	if len(q) != 3 || q[0].ID != last || q[1].VideoID != "aaaaaaaaaaa" || q[2].VideoID != "bbbbbbbbbbb" {
		t.Fatalf("move mangled the queue: %+v", q)
	}
	// An index past the end lands last, not out of bounds.
	if !accepted(j, protocol.JukeboxCommand{Action: "move", EntryID: last, Index: 99}, "r-jan", "jan", jat(3)) {
		t.Fatal("clamped move refused")
	}
	if q := j.snapshot().Queue; q[2].ID != last {
		t.Fatalf("clamp: %+v", q)
	}
	// A no-op move and an unknown entry are both refused.
	if accepted(j, protocol.JukeboxCommand{Action: "move", EntryID: last, Index: 2}, "r-jan", "jan", jat(4)) {
		t.Fatal("no-op move accepted")
	}
	if accepted(j, protocol.JukeboxCommand{Action: "move", EntryID: "nope", Index: 0}, "r-jan", "jan", jat(5)) {
		t.Fatal("move of an unknown entry accepted")
	}
}

func TestHistoryRemembersTheLastFive(t *testing.T) {
	j := newJukebox()
	ids := []string{"aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd", "eeeeeeeeeee", "fffffffffff", "ggggggggggg"}
	for i, id := range ids {
		add(j, id, jat(i))
	}
	for i := range ids {
		accepted(j, protocol.JukeboxCommand{Action: "skip"}, "r-jan", "jan", jat(100+i))
	}
	h := j.snapshot().History
	if len(h) != maxHistory {
		t.Fatalf("history length %d", len(h))
	}
	// Newest first, and the cap drops the oldest.
	if h[0].VideoID != "ggggggggggg" || h[4].VideoID != "ccccccccccc" {
		t.Fatalf("history order: %+v", h)
	}
	if s := j.snapshot(); s.Current != nil || s.Playing {
		t.Fatalf("dry deck still playing: %+v", s)
	}
}

func TestSeekMovesTheSharedPlayhead(t *testing.T) {
	j := newJukebox()
	// No deck → refuse.
	if accepted(j, protocol.JukeboxCommand{Action: "seek", PositionSec: 10}, "r-jan", "jan", jat(0)) {
		t.Fatal("seek with empty deck accepted")
	}
	add(j, "dQw4w9WgXcQ", jat(0))
	if !accepted(j, protocol.JukeboxCommand{Action: "seek", PositionSec: 94}, "r-jan", "jan", jat(10)) {
		t.Fatal("seek refused")
	}
	if got := j.positionAt(jat(15)); got != 99 {
		t.Fatalf("playhead after seek: %v", got)
	}
	// Untrusted input clamps: negatives to zero, silly hours to the cap.
	accepted(j, protocol.JukeboxCommand{Action: "seek", PositionSec: -5}, "r-jan", "jan", jat(20))
	if got := j.positionAt(jat(20)); got != 0 {
		t.Fatalf("negative seek: %v", got)
	}
	accepted(j, protocol.JukeboxCommand{Action: "seek", PositionSec: 1e9}, "r-jan", "jan", jat(20))
	if got := j.positionAt(jat(20)); got != maxSeekSec {
		t.Fatalf("huge seek: %v", got)
	}
	// Seeking while paused moves the playhead and stays paused.
	accepted(j, protocol.JukeboxCommand{Action: "pause"}, "r-jan", "jan", jat(30))
	accepted(j, protocol.JukeboxCommand{Action: "seek", PositionSec: 60}, "r-jan", "jan", jat(31))
	s := j.snapshot()
	if s.Playing || j.positionAt(jat(99)) != 60 {
		t.Fatalf("paused seek: playing=%v pos=%v", s.Playing, j.positionAt(jat(99)))
	}
}

func TestPastedTimestampStartsTheEntryThere(t *testing.T) {
	j := newJukebox()
	// Empty deck: plays immediately from the timestamp.
	accepted(j, protocol.JukeboxCommand{Action: "add", VideoID: "dQw4w9WgXcQ", PositionSec: 94}, "r-jan", "jan", jat(0))
	if got := j.positionAt(jat(6)); got != 100 {
		t.Fatalf("start-at on immediate play: %v", got)
	}
	// Queued: the timestamp waits with the entry until it reaches the deck.
	accepted(j, protocol.JukeboxCommand{Action: "add", VideoID: "abcdefghijk", PositionSec: 30}, "r-jan", "jan", jat(1))
	accepted(j, protocol.JukeboxCommand{Action: "skip"}, "r-jan", "jan", jat(10))
	if got := j.positionAt(jat(12)); got != 32 {
		t.Fatalf("start-at from queue: %v", got)
	}
}

// A track from the self-hosted pool (#267, ADR-0015). The deck's rules are
// source-agnostic — the point of the issue is that a pool track is just
// another queue entry — so these check the shape gate and that nothing about
// the deck changes because the audio lives somewhere else.

const poolTrack = "6c60e0eb-850f-4067-b746-1995c7051b45"

func addTrack(j *jukebox, id string, at time.Time) bool {
	return accepted(j, protocol.JukeboxCommand{
		Action: "add", TrackID: id, Title: "Sandstorm", Artist: "Darude",
	}, "r-jan", "jan", at)
}

func TestAPoolTrackPlaysAnEmptyDeckLikeAnyOther(t *testing.T) {
	j := newJukebox()
	if !addTrack(j, poolTrack, jat(0)) {
		t.Fatal("add refused")
	}
	s := j.snapshot()
	if s.Current == nil {
		t.Fatal("an empty deck should play the first entry, whatever its source")
	}
	if s.Current.TrackID != poolTrack {
		t.Errorf("track id: %q", s.Current.TrackID)
	}
	if s.Current.VideoID != "" {
		t.Errorf("a pool track carries no video id, got %q", s.Current.VideoID)
	}
	if s.Current.Title != "Sandstorm" || s.Current.Artist != "Darude" {
		t.Errorf("display metadata: %q / %q", s.Current.Title, s.Current.Artist)
	}
	if !s.Playing {
		t.Error("adding to an empty deck is pressing play")
	}
}

func TestAPoolTrackIsCheckedForShapeOnly(t *testing.T) {
	// The hub never reaches for the database (server/AGENTS.md): whether the
	// row exists is the audio endpoint's answer, not the deck's.
	for _, id := range []string{"", "not-a-uuid", "../../etc/passwd", strings.Repeat("a", 36)} {
		j := newJukebox()
		if addTrack(j, id, jat(0)) {
			t.Errorf("accepted a track id of %q", id)
		}
	}
	j := newJukebox()
	if !addTrack(j, poolTrack, jat(0)) {
		t.Error("refused a well-shaped uuid")
	}
}

func TestAPoolTrackAndAVideoShareOneQueue(t *testing.T) {
	j := newJukebox()
	add(j, "dQw4w9WgXcQ", jat(0)) // plays
	addTrack(j, poolTrack, jat(1))
	add(j, "abcdefghijk", jat(2))
	s := j.snapshot()
	if len(s.Queue) != 2 {
		t.Fatalf("queue: %d", len(s.Queue))
	}
	if s.Queue[0].TrackID != poolTrack || s.Queue[1].VideoID != "abcdefghijk" {
		t.Errorf("interleaved order lost: %+v", s.Queue)
	}
	// Skipping into the pool track is the ordinary advance — no branch.
	accepted(j, protocol.JukeboxCommand{Action: "skip"}, "r-jan", "jan", jat(3))
	if got := j.snapshot().Current; got == nil || got.TrackID != poolTrack {
		t.Errorf("skip should land on the pool track, got %+v", got)
	}
}

func TestAPoolTrackEndsOnItsOwnID(t *testing.T) {
	j := newJukebox()
	addTrack(j, poolTrack, jat(0))
	add(j, "dQw4w9WgXcQ", jat(1))
	anchor := j.snapshot().AnchorMs

	// The case only the TrackID check catches: a stale client that had a
	// DIFFERENT pool track loaded reports its end. Both carry no video id,
	// so matching on VideoID alone compares "" to "" and lets it through —
	// advancing the deck past a track nobody finished.
	const otherTrack = "11111111-2222-3333-4444-555555555555"
	if accepted(j, protocol.JukeboxCommand{
		Action: "ended", TrackID: otherTrack, AnchorMs: anchor,
	}, "r-kim", "kim", jat(2)) {
		t.Error("another pool track's end advanced this one")
	}
	if got := j.snapshot().Current; got == nil || got.TrackID != poolTrack {
		t.Fatalf("deck moved: %+v", got)
	}

	if !accepted(j, protocol.JukeboxCommand{
		Action: "ended", TrackID: poolTrack, AnchorMs: anchor,
	}, "r-jan", "jan", jat(3)) {
		t.Fatal("the track's own end was refused")
	}
	if got := j.snapshot().Current; got == nil || got.VideoID != "dQw4w9WgXcQ" {
		t.Errorf("should have advanced to the video, got %+v", got)
	}
}

// A library track's length rides along its add and is bounded like a seek (#1509).
func TestAddCarriesALibraryTrackLength(t *testing.T) {
	cases := []struct {
		name     string
		in, want int
	}{
		{"measured", 192_914, 192_914},
		{"unknown", 0, 0},
		{"past six hours", maxSeekSec*1000 + 1, 0},
		{"negative", -5, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			j := newJukebox()
			cmd := protocol.JukeboxCommand{Action: "add", TrackID: poolTrack, Title: "Sandstorm", DurationMs: tc.in}
			if !accepted(j, cmd, "r-jan", "jan", jat(0)) {
				t.Fatal("add refused")
			}
			if got := j.snapshot().Current.DurationMs; got != tc.want {
				t.Fatalf("durationMs = %d, want %d", got, tc.want)
			}
		})
	}
}
