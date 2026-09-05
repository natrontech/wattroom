package hub

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestRoomLoopSurvivesAPanic(t *testing.T) {
	// #651: a panic inside one room's tick used to end the process — every
	// room, every rider, mid-interval. Now the loop is relaunched and the next
	// tick reaches the socket. Without the guard this test binary would die
	// here rather than fail.
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	rm := newRoom("flaky")
	var panicked atomic.Bool
	// The presence push runs on the tick goroutine, outside the room lock —
	// the same place a game mode or the jukebox would blow up. Once.
	rm.changed = func() {
		if panicked.CompareAndSwap(false, true) {
			panic("presence push blew up")
		}
	}
	h.mu.Lock()
	h.rooms["flaky"] = rm
	h.mu.Unlock()
	h.launchRoom(rm)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	conn := dial(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws/rooms/flaky", "jan:owner")

	// The first tick with a rider present panics before it is written; the
	// relaunched loop's tick is the one that arrives.
	tick := readTick(t, conn)
	if !panicked.Load() {
		t.Fatal("the injected panic never fired — this test proved nothing")
	}
	if tick.State.Phase != "idle" {
		t.Fatalf("relaunched loop lost the room: phase %q", tick.State.Phase)
	}
}
