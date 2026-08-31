package hub

import (
	"strings"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

func jat(sec int) time.Time { return time.Unix(2_000_000+int64(sec), 0) }

func add(j *jukebox, id string, at time.Time) bool {
	return j.apply(protocol.JukeboxCommand{Action: "add", VideoID: id, Title: "t-" + id}, "jan", at)
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

func TestAnchorSurvivesPause(t *testing.T) {
	j := newJukebox()
	add(j, "dQw4w9WgXcQ", jat(0))
	if got := j.positionAt(jat(30)); got != 30 {
		t.Fatalf("playhead: %v", got)
	}
	j.apply(protocol.JukeboxCommand{Action: "pause"}, "jan", jat(30))
	if got := j.positionAt(jat(90)); got != 30 {
		t.Fatalf("paused playhead moved: %v", got)
	}
	j.apply(protocol.JukeboxCommand{Action: "play"}, "jan", jat(90))
	if got := j.positionAt(jat(100)); got != 40 {
		t.Fatalf("resumed playhead: %v", got)
	}
}

func TestEndedAdvancesExactlyOnce(t *testing.T) {
	// Every client in the room reports the end; only the first report for the
	// current video advances — the rest are the same event echoing back.
	j := newJukebox()
	add(j, "dQw4w9WgXcQ", jat(0))
	add(j, "abcdefghijk", jat(1))
	for i := 0; i < 5; i++ {
		j.apply(protocol.JukeboxCommand{Action: "ended", VideoID: "dQw4w9WgXcQ"}, "jan", jat(200))
	}
	s := j.snapshot()
	if s.Current == nil || s.Current.VideoID != "abcdefghijk" || len(s.Queue) != 0 {
		t.Fatalf("echoed ended double-advanced: %+v", s)
	}
	// Deck runs dry cleanly.
	j.apply(protocol.JukeboxCommand{Action: "ended", VideoID: "abcdefghijk"}, "jan", jat(400))
	if s := j.snapshot(); s.Current != nil || s.Playing {
		t.Fatalf("dry deck still playing: %+v", s)
	}
}

func TestJunkRefused(t *testing.T) {
	j := newJukebox()
	if j.apply(protocol.JukeboxCommand{Action: "add", VideoID: "'; drop--"}, "x", jat(0)) {
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

func TestRemoveFromQueue(t *testing.T) {
	j := newJukebox()
	add(j, "dQw4w9WgXcQ", jat(0))
	add(j, "abcdefghijk", jat(1))
	if !j.apply(protocol.JukeboxCommand{Action: "remove", VideoID: "abcdefghijk"}, "jan", jat(2)) {
		t.Fatal("remove refused")
	}
	if len(j.snapshot().Queue) != 0 {
		t.Fatal("remove did not remove")
	}
}

func TestJamLink(t *testing.T) {
	j := newJukebox()
	now := time.Now()

	for _, bad := range []string{
		"http://open.spotify.com/jam/abc",                  // not https
		"https://evil.example/jam/abc",                     // wrong host
		"https://open.spotify.com.evil.io/",                // host suffix trick
		"https://spotify.link/" + strings.Repeat("a", 300), // over the cap
	} {
		if j.apply(protocol.JukeboxCommand{Action: "jam", JamURL: bad}, "jan", now) {
			t.Fatalf("accepted %q", bad)
		}
	}

	for _, good := range []string{
		"https://open.spotify.com/jam/abc123",
		"https://spotify.link/xYz",
	} {
		if !j.apply(protocol.JukeboxCommand{Action: "jam", JamURL: good}, "jan", now) {
			t.Fatalf("rejected %q", good)
		}
		if j.snapshot().JamURL != good {
			t.Fatalf("not stored: %q", good)
		}
	}

	// Empty clears — the host taking the card down.
	if !j.apply(protocol.JukeboxCommand{Action: "jam"}, "jan", now) {
		t.Fatal("clear rejected")
	}
	if j.snapshot().JamURL != "" {
		t.Fatal("not cleared")
	}
}

func TestSeekMovesTheSharedPlayhead(t *testing.T) {
	j := newJukebox()
	// No deck → refuse.
	if j.apply(protocol.JukeboxCommand{Action: "seek", PositionSec: 10}, "jan", jat(0)) {
		t.Fatal("seek with empty deck accepted")
	}
	add(j, "dQw4w9WgXcQ", jat(0))
	if !j.apply(protocol.JukeboxCommand{Action: "seek", PositionSec: 94}, "jan", jat(10)) {
		t.Fatal("seek refused")
	}
	if got := j.positionAt(jat(15)); got != 99 {
		t.Fatalf("playhead after seek: %v", got)
	}
	// Untrusted input clamps: negatives to zero, silly hours to the cap.
	j.apply(protocol.JukeboxCommand{Action: "seek", PositionSec: -5}, "jan", jat(20))
	if got := j.positionAt(jat(20)); got != 0 {
		t.Fatalf("negative seek: %v", got)
	}
	j.apply(protocol.JukeboxCommand{Action: "seek", PositionSec: 1e9}, "jan", jat(20))
	if got := j.positionAt(jat(20)); got != maxSeekSec {
		t.Fatalf("huge seek: %v", got)
	}
	// Seeking while paused moves the playhead and stays paused.
	j.apply(protocol.JukeboxCommand{Action: "pause"}, "jan", jat(30))
	j.apply(protocol.JukeboxCommand{Action: "seek", PositionSec: 60}, "jan", jat(31))
	s := j.snapshot()
	if s.Playing || j.positionAt(jat(99)) != 60 {
		t.Fatalf("paused seek: playing=%v pos=%v", s.Playing, j.positionAt(jat(99)))
	}
}

func TestPastedTimestampStartsTheEntryThere(t *testing.T) {
	j := newJukebox()
	// Empty deck: plays immediately from the timestamp.
	j.apply(protocol.JukeboxCommand{Action: "add", VideoID: "dQw4w9WgXcQ", PositionSec: 94}, "jan", jat(0))
	if got := j.positionAt(jat(6)); got != 100 {
		t.Fatalf("start-at on immediate play: %v", got)
	}
	// Queued: the timestamp waits with the entry until it reaches the deck.
	j.apply(protocol.JukeboxCommand{Action: "add", VideoID: "abcdefghijk", PositionSec: 30}, "jan", jat(1))
	j.apply(protocol.JukeboxCommand{Action: "skip"}, "jan", jat(10))
	if got := j.positionAt(jat(12)); got != 32 {
		t.Fatalf("start-at from queue: %v", got)
	}
}
