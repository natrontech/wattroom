package hub

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"log/slog"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// fakeAutoplaySource stands in for the playlists package (#627): a fixed
// canned answer, so these tests exercise the hub's trigger/idle-recheck
// wiring, not a database.
type fakeAutoplaySource struct {
	fixed  *protocol.JukeboxCommand
	tracks []protocol.JukeboxCommand
	ok     bool
}

func (f fakeAutoplaySource) Autoplay(context.Context, string) (*protocol.JukeboxCommand, []protocol.JukeboxCommand, bool) {
	return f.fixed, f.tracks, f.ok
}

func TestAutoplaySeedsAnIdleDeckOnJoin(t *testing.T) {
	fixed := protocol.JukeboxCommand{Action: "add", VideoID: "dQw4w9WgXcQ", Title: "Warmup"}
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	h.SetPlaylistSource(fakeAutoplaySource{
		fixed: &fixed,
		tracks: []protocol.JukeboxCommand{
			{Action: "add", VideoID: "9bZkp7q19f0", Title: "Track 2"},
		},
		ok: true,
	})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/rooms/autoplay-room"

	first := dial(t, url, "jan:owner")
	var tick protocol.ServerTick
	deadline := time.Now().Add(5 * time.Second)
	for {
		tick = readTick(t, first)
		if tick.Jukebox.Current != nil || time.Now().After(deadline) {
			break
		}
	}
	if tick.Jukebox.Current == nil || tick.Jukebox.Current.VideoID != "dQw4w9WgXcQ" {
		t.Fatalf("fixed starter did not reach the deck: %+v", tick.Jukebox)
	}
	if len(tick.Jukebox.Queue) != 1 || tick.Jukebox.Queue[0].VideoID != "9bZkp7q19f0" {
		t.Fatalf("the playlist behind it did not queue: %+v", tick.Jukebox.Queue)
	}

	// A second rider joining a deck that is now playing must not re-trigger
	// and double the queue — idle is re-checked under the lock (#627).
	dial(t, url, "sven:member")
	time.Sleep(100 * time.Millisecond)
	tick = readTick(t, first)
	if len(tick.Jukebox.Queue) != 1 {
		t.Fatalf("a join onto a playing deck queued again: %+v", tick.Jukebox.Queue)
	}
}

func TestAutoplaySilentWhenSourceHasNothing(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	h.SetPlaylistSource(fakeAutoplaySource{ok: false})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/rooms/quiet-room"

	conn := dial(t, url, "jan:owner")
	tick := readTick(t, conn)
	if tick.Jukebox.Current != nil {
		t.Fatalf("deck should stay idle when autoplay has nothing to play: %+v", tick.Jukebox)
	}
}

func TestQueuePlaylistReachesAnOccupiedRoom(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/rooms/bridge-room"

	// Nobody connected yet: the bridge reports no live room to seed.
	if _, ok := h.QueuePlaylist("bridge-room", "jan", "Jan", []protocol.JukeboxCommand{
		{Action: "add", VideoID: "dQw4w9WgXcQ", Title: "Track"},
	}); ok {
		t.Fatalf("queue into an unoccupied room should report not-live")
	}

	conn := dial(t, url, "jan:owner")
	readTick(t, conn)

	added, ok := h.QueuePlaylist("bridge-room", "jan", "Jan", []protocol.JukeboxCommand{
		{Action: "add", VideoID: "dQw4w9WgXcQ", Title: "Track 1"},
		{Action: "add", VideoID: "9bZkp7q19f0", Title: "Track 2"},
	})
	if !ok || added != 2 {
		t.Fatalf("queue into an occupied room: added=%d ok=%v", added, ok)
	}
	var tick protocol.ServerTick
	deadline := time.Now().Add(5 * time.Second)
	for {
		tick = readTick(t, conn)
		if tick.Jukebox.Current != nil || time.Now().After(deadline) {
			break
		}
	}
	if tick.Jukebox.Current == nil || tick.Jukebox.Current.VideoID != "dQw4w9WgXcQ" {
		t.Fatalf("queued tracks did not reach the deck: %+v", tick.Jukebox)
	}
	if len(tick.Jukebox.Queue) != 1 || tick.Jukebox.Queue[0].VideoID != "9bZkp7q19f0" {
		t.Fatalf("second track did not land in the queue: %+v", tick.Jukebox.Queue)
	}
}

// endTrack reports the deck's current track as ended, the way every client
// does when the video finishes — with the anchor the tick carried, so the
// server takes it as this play's end and not an echo of an earlier one.
func endTrack(t *testing.T, conn *websocket.Conn, deck protocol.JukeboxState) {
	t.Helper()
	if err := wsjson.Write(t.Context(), conn, protocol.ClientMessage{
		Jukebox: &protocol.JukeboxCommand{Action: "ended", VideoID: deck.Current.VideoID, AnchorMs: deck.AnchorMs},
	}); err != nil {
		t.Fatalf("send ended: %v", err)
	}
}

// tickUntil reads ticks until the deck satisfies want, or fails the test.
func tickUntil(t *testing.T, conn *websocket.Conn, what string, want func(protocol.JukeboxState) bool) protocol.JukeboxState {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		tick := readTick(t, conn)
		if want(tick.Jukebox) {
			return tick.Jukebox
		}
		if time.Now().After(deadline) {
			t.Fatalf("%s never happened; deck: %+v", what, tick.Jukebox)
		}
	}
}

func TestAutoplayLoopsThePlaylistWhenTheDeckRunsDry(t *testing.T) {
	fixed := protocol.JukeboxCommand{Action: "add", VideoID: "dQw4w9WgXcQ", Title: "Warmup"}
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	h.SetPlaylistSource(fakeAutoplaySource{
		fixed:  &fixed,
		tracks: []protocol.JukeboxCommand{{Action: "add", VideoID: "9bZkp7q19f0", Title: "Track"}},
		ok:     true,
	})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	conn := dial(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws/rooms/loop-room", "jan:owner")

	playing := func(videoID string) func(protocol.JukeboxState) bool {
		return func(deck protocol.JukeboxState) bool {
			return deck.Current != nil && deck.Current.VideoID == videoID
		}
	}
	deck := tickUntil(t, conn, "fixed starter on the deck", playing("dQw4w9WgXcQ"))
	endTrack(t, conn, deck)
	deck = tickUntil(t, conn, "playlist track after the starter", playing("9bZkp7q19f0"))
	firstPass := deck.Current.ID

	// The last track ends with nobody joining: the playlist comes back on
	// its own (SPEC: ordered "loops the active playlist"), as a fresh entry.
	endTrack(t, conn, deck)
	deck = tickUntil(t, conn, "the playlist looping", func(d protocol.JukeboxState) bool {
		return playing("9bZkp7q19f0")(d) && d.Current.ID != firstPass
	})
	// The fixed start is a start: it does not come round again.
	if len(deck.Queue) != 0 {
		t.Fatalf("a loop should queue only the playlist, got %+v", deck.Queue)
	}
	if deck.Current.AddedBy != autoplayActor {
		t.Fatalf("the looped track should carry autoplay's name, got %q", deck.Current.AddedBy)
	}
}

func TestAutoplayOffLeavesADryDeckIdle(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	h.SetPlaylistSource(fakeAutoplaySource{ok: false})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	conn := dial(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws/rooms/one-shot-room", "jan:owner")
	readTick(t, conn)

	if err := wsjson.Write(t.Context(), conn, protocol.ClientMessage{
		Jukebox: &protocol.JukeboxCommand{Action: "add", VideoID: "dQw4w9WgXcQ", Title: "Only"},
	}); err != nil {
		t.Fatalf("send add: %v", err)
	}
	deck := tickUntil(t, conn, "the manual add on the deck", func(d protocol.JukeboxState) bool { return d.Current != nil })
	endTrack(t, conn, deck)

	// Two ticks is long past the worker's turnaround; the deck must still
	// be empty — nothing to loop, nothing to spin on.
	readTick(t, conn)
	if deck = readTick(t, conn).Jukebox; deck.Current != nil || len(deck.Queue) != 0 {
		t.Fatalf("autoplay off must leave a dry deck idle: %+v", deck)
	}
}

func TestAutoplayFixedStartAloneDoesNotLoop(t *testing.T) {
	fixed := protocol.JukeboxCommand{Action: "add", VideoID: "dQw4w9WgXcQ", Title: "Anthem"}
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	h.SetPlaylistSource(fakeAutoplaySource{fixed: &fixed, ok: true})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	conn := dial(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws/rooms/anthem-room", "jan:owner")

	deck := tickUntil(t, conn, "fixed starter on the deck", func(d protocol.JukeboxState) bool { return d.Current != nil })
	endTrack(t, conn, deck)

	readTick(t, conn)
	if deck = readTick(t, conn).Jukebox; deck.Current != nil {
		t.Fatalf("a fixed start with no playlist must not replay itself: %+v", deck)
	}
}
