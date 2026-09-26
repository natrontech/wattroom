package hub

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// rawTick reads the next tick as it came off the wire — no deck filled back
// in, which is what readTick does for every other test.
func rawTick(t *testing.T, conn *websocket.Conn) protocol.ServerTick {
	t.Helper()
	for {
		ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
		var msg protocol.ServerMessage
		err := wsjson.Read(ctx, conn, &msg)
		cancel()
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		if msg.Tick != nil {
			return *msg.Tick
		}
	}
}

// The deck changes with a command, never with the clock — its position is an
// anchor — so it rides only the tick a socket has not heard it on (#2838), the
// way the workout rides by hash (#1710). A few queued playlists were 85–97 %
// of every frame, every second, to every socket in the channel.
func TestTheDeckRidesOnlyTheTicksThatChangeIt(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/channels/deck-rev"

	jan := dial(t, url, "jan:owner")
	first := rawTick(t, jan)
	if first.Jukebox == nil || first.JukeboxRev == 0 {
		t.Fatalf("a socket's first tick carried no deck: rev %d deck %+v", first.JukeboxRev, first.Jukebox)
	}
	for range 2 {
		if tick := rawTick(t, jan); tick.Jukebox != nil || tick.JukeboxRev != first.JukeboxRev {
			t.Fatalf("an unchanged deck rode again: rev %d (heard %d) deck %+v", tick.JukeboxRev, first.JukeboxRev, tick.Jukebox)
		}
	}

	if err := wsjson.Write(t.Context(), jan, protocol.ClientMessage{
		Jukebox: &protocol.JukeboxCommand{Action: "add", VideoID: "dQw4w9WgXcQ", Title: "Warmup"},
	}); err != nil {
		t.Fatalf("add: %v", err)
	}
	var changed protocol.ServerTick
	for deadline := time.Now().Add(5 * time.Second); ; {
		if changed = rawTick(t, jan); changed.Jukebox != nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the deck a command changed never went out")
		}
	}
	if changed.JukeboxRev == first.JukeboxRev || changed.Jukebox.Current == nil || changed.Jukebox.Current.VideoID != "dQw4w9WgXcQ" {
		t.Fatalf("the changed deck: rev %d (was %d) %+v", changed.JukeboxRev, first.JukeboxRev, changed.Jukebox)
	}

	// Heard per socket, not per channel: a rider joining now gets the deck on
	// their first tick while jan, who has it, does not get it again.
	kim := dial(t, url, "kim:member")
	if tick := rawTick(t, kim); tick.Jukebox == nil || tick.Jukebox.Current == nil {
		t.Fatalf("a late joiner's first tick carried no deck: %+v", tick.Jukebox)
	}
	if tick := rawTick(t, jan); tick.Jukebox != nil {
		t.Fatalf("the deck jan already holds rode to jan again: %+v", tick.Jukebox)
	}
}
