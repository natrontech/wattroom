package hub

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"log/slog"

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
