package hub

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

func TestRoomLoopSurvivesAPanic(t *testing.T) {
	// #651: a panic inside one room's tick used to end the process — every
	// room, every rider, mid-interval. Now the loop is relaunched and the next
	// tick reaches the socket. Without the guard this test binary would die
	// here rather than fail.
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	rm := newRoom("flaky")
	var panicked atomic.Bool
	// The presence push runs on the tick goroutine, outside the room lock.
	// Once. The locked half of the tick has its own test below.
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

// A game mode that blows up on its first tick — under rm.mu, where the game,
// the jukebox and the session close all run.
type panickingMode struct{ fired atomic.Bool }

func (m *panickingMode) advance(time.Time, map[string]int, map[string]protocol.Rider) {
	if m.fired.CompareAndSwap(false, true) {
		panic("game mode blew up under the lock")
	}
}
func (m *panickingMode) state(time.Time) protocol.GameState { return protocol.GameState{} }
func (m *panickingMode) done() bool                         { return false }

func TestRoomLoopReleasesTheLockAfterAPanic(t *testing.T) {
	// #824: the tick locks by hand. A panic inside the locked half used to
	// unwind with the mutex held, and the relaunched loop then parked on
	// Lock() forever — a room that never ticked again, and every hub-wide
	// walk over rooms hung behind it.
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	rm := newRoom("wedged")
	mode := &panickingMode{}
	rm.game = mode
	h.mu.Lock()
	h.rooms["wedged"] = rm
	h.mu.Unlock()
	h.launchRoom(rm)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	conn := dial(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws/rooms/wedged", "jan:owner")

	tick := readTick(t, conn)
	if !mode.fired.Load() {
		t.Fatal("the injected panic never fired — this test proved nothing")
	}
	if tick.State.Phase != "idle" {
		t.Fatalf("relaunched loop lost the room: phase %q", tick.State.Phase)
	}
	if !rm.mu.TryLock() {
		t.Fatal("the room mutex is still held after the panic")
	}
	rm.mu.Unlock()
}
