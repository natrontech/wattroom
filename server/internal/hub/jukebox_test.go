package hub

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

func jat(sec int) time.Time { return time.Unix(2_000_000+int64(sec), 0) }

func add(j *jukebox, id string, at time.Time) bool {
	return j.apply(protocol.JukeboxCommand{Action: "add", VideoID: id, Title: "t-" + id}, "r-jan", "jan", at)
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
	j.apply(protocol.JukeboxCommand{Action: "pause"}, "r-jan", "jan", jat(30))
	if got := j.positionAt(jat(90)); got != 30 {
		t.Fatalf("paused playhead moved: %v", got)
	}
	j.apply(protocol.JukeboxCommand{Action: "play"}, "r-jan", "jan", jat(90))
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
		j.apply(protocol.JukeboxCommand{Action: "ended", VideoID: "dQw4w9WgXcQ", AnchorMs: epoch}, "r-jan", "jan", jat(200))
	}
	s := j.snapshot()
	if s.Current == nil || s.Current.VideoID != "dQw4w9WgXcQ" || len(s.Queue) != 1 {
		t.Fatalf("echoed ended double-advanced past the duplicate: %+v", s)
	}
	// A report without the current epoch is an echo from a past life — no-op.
	if j.apply(protocol.JukeboxCommand{Action: "ended", VideoID: "dQw4w9WgXcQ", AnchorMs: epoch}, "r-jan", "jan", jat(300)) {
		t.Fatal("stale-epoch ended accepted")
	}
	// The real second play ends with ITS epoch, then the deck runs dry.
	epoch2 := j.snapshot().AnchorMs
	j.apply(protocol.JukeboxCommand{Action: "ended", VideoID: "dQw4w9WgXcQ", AnchorMs: epoch2}, "r-jan", "jan", jat(400))
	epoch3 := j.snapshot().AnchorMs
	j.apply(protocol.JukeboxCommand{Action: "ended", VideoID: "abcdefghijk", AnchorMs: epoch3}, "r-jan", "jan", jat(500))
	if s := j.snapshot(); s.Current != nil || s.Playing {
		t.Fatalf("dry deck still playing: %+v", s)
	}
}

func TestJunkRefused(t *testing.T) {
	j := newJukebox()
	if j.apply(protocol.JukeboxCommand{Action: "add", VideoID: "'; drop--"}, "r-x", "x", jat(0)) {
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

func TestRemoveTakesTheEntryNotTheVideo(t *testing.T) {
	// The same track queued twice is two entries; removing the second must
	// not take the first (#286 — the old remove matched on videoId).
	j := newJukebox()
	add(j, "dQw4w9WgXcQ", jat(0)) // straight to the deck
	add(j, "abcdefghijk", jat(1))
	add(j, "abcdefghijk", jat(2))
	second := j.snapshot().Queue[1].ID
	if !j.apply(protocol.JukeboxCommand{Action: "remove", EntryID: second}, "r-jan", "jan", jat(3)) {
		t.Fatal("remove refused")
	}
	q := j.snapshot().Queue
	if len(q) != 1 || q[0].ID == second {
		t.Fatalf("removed the wrong entry: %+v", q)
	}
	if j.apply(protocol.JukeboxCommand{Action: "remove", EntryID: "nope"}, "r-jan", "jan", jat(4)) {
		t.Fatal("remove of an unknown entry accepted")
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
	if !j.apply(protocol.JukeboxCommand{Action: "vote", EntryID: third}, "r-jan", "jan", jat(2)) {
		t.Fatal("vote refused")
	}
	if got := j.snapshot().Queue[0]; got.ID != third || len(got.Voters) != 1 {
		t.Fatalf("vote did not float the entry: %+v", j.snapshot().Queue)
	}
	// A second rider adds to it; the same rider twice is a toggle, not a stack.
	j.apply(protocol.JukeboxCommand{Action: "vote", EntryID: third}, "r-ada", "ada", jat(3))
	j.apply(protocol.JukeboxCommand{Action: "vote", EntryID: third}, "r-ada", "ada", jat(4))
	if got := len(j.snapshot().Queue[0].Voters); got != 1 {
		t.Fatalf("toggle left %d voters", got)
	}
	// Anonymous votes (no rider id) have nothing to toggle — refused.
	if j.apply(protocol.JukeboxCommand{Action: "vote", EntryID: third}, "", "", jat(5)) {
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
	if !j.apply(protocol.JukeboxCommand{Action: "move", EntryID: last, Index: 0}, "r-jan", "jan", jat(2)) {
		t.Fatal("move refused")
	}
	q := j.snapshot().Queue
	if len(q) != 3 || q[0].ID != last || q[1].VideoID != "aaaaaaaaaaa" || q[2].VideoID != "bbbbbbbbbbb" {
		t.Fatalf("move mangled the queue: %+v", q)
	}
	// An index past the end lands last, not out of bounds.
	if !j.apply(protocol.JukeboxCommand{Action: "move", EntryID: last, Index: 99}, "r-jan", "jan", jat(3)) {
		t.Fatal("clamped move refused")
	}
	if q := j.snapshot().Queue; q[2].ID != last {
		t.Fatalf("clamp: %+v", q)
	}
	// A no-op move and an unknown entry are both refused.
	if j.apply(protocol.JukeboxCommand{Action: "move", EntryID: last, Index: 2}, "r-jan", "jan", jat(4)) {
		t.Fatal("no-op move accepted")
	}
	if j.apply(protocol.JukeboxCommand{Action: "move", EntryID: "nope", Index: 0}, "r-jan", "jan", jat(5)) {
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
		j.apply(protocol.JukeboxCommand{Action: "skip"}, "r-jan", "jan", jat(100+i))
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
	if j.apply(protocol.JukeboxCommand{Action: "seek", PositionSec: 10}, "r-jan", "jan", jat(0)) {
		t.Fatal("seek with empty deck accepted")
	}
	add(j, "dQw4w9WgXcQ", jat(0))
	if !j.apply(protocol.JukeboxCommand{Action: "seek", PositionSec: 94}, "r-jan", "jan", jat(10)) {
		t.Fatal("seek refused")
	}
	if got := j.positionAt(jat(15)); got != 99 {
		t.Fatalf("playhead after seek: %v", got)
	}
	// Untrusted input clamps: negatives to zero, silly hours to the cap.
	j.apply(protocol.JukeboxCommand{Action: "seek", PositionSec: -5}, "r-jan", "jan", jat(20))
	if got := j.positionAt(jat(20)); got != 0 {
		t.Fatalf("negative seek: %v", got)
	}
	j.apply(protocol.JukeboxCommand{Action: "seek", PositionSec: 1e9}, "r-jan", "jan", jat(20))
	if got := j.positionAt(jat(20)); got != maxSeekSec {
		t.Fatalf("huge seek: %v", got)
	}
	// Seeking while paused moves the playhead and stays paused.
	j.apply(protocol.JukeboxCommand{Action: "pause"}, "r-jan", "jan", jat(30))
	j.apply(protocol.JukeboxCommand{Action: "seek", PositionSec: 60}, "r-jan", "jan", jat(31))
	s := j.snapshot()
	if s.Playing || j.positionAt(jat(99)) != 60 {
		t.Fatalf("paused seek: playing=%v pos=%v", s.Playing, j.positionAt(jat(99)))
	}
}

func TestPastedTimestampStartsTheEntryThere(t *testing.T) {
	j := newJukebox()
	// Empty deck: plays immediately from the timestamp.
	j.apply(protocol.JukeboxCommand{Action: "add", VideoID: "dQw4w9WgXcQ", PositionSec: 94}, "r-jan", "jan", jat(0))
	if got := j.positionAt(jat(6)); got != 100 {
		t.Fatalf("start-at on immediate play: %v", got)
	}
	// Queued: the timestamp waits with the entry until it reaches the deck.
	j.apply(protocol.JukeboxCommand{Action: "add", VideoID: "abcdefghijk", PositionSec: 30}, "r-jan", "jan", jat(1))
	j.apply(protocol.JukeboxCommand{Action: "skip"}, "r-jan", "jan", jat(10))
	if got := j.positionAt(jat(12)); got != 32 {
		t.Fatalf("start-at from queue: %v", got)
	}
}
