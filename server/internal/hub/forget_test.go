package hub

import (
	"bytes"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// lines is a logger the test can read back from the room's own goroutine,
// which is where "room forgotten" is written.
type lines struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (l *lines) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.Write(p)
}

func (l *lines) says(want string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return strings.Contains(l.buf.String(), want)
}

// forgetHub is a hub whose log the test reads, plus the teardown the synctest
// bubble needs: every goroutine New and room() started has to exit before the
// bubble closes, and the hub has no shutdown of its own.
func forgetHub(t *testing.T) (*Hub, *lines) {
	t.Helper()
	out := &lines{}
	h := New(slog.New(slog.NewTextHandler(out, nil)), fakeAccess{}, nil)
	t.Cleanup(func() {
		h.mu.Lock()
		rooms := make([]*room, 0, len(h.rooms))
		for _, rm := range h.rooms {
			rooms = append(rooms, rm)
		}
		h.mu.Unlock()
		for _, rm := range rooms {
			close(rm.stop)
		}
		close(h.autoplays)
	})
	return h, out
}

// live is the hub's room at channel, or nil once it has been forgotten.
func live(h *Hub, channel string) *room {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.rooms[channel]
}

// A channel anyone had ever joined kept its tick goroutine, jukebox queue, chat
// buffer, timeline and roster for the life of the process: nothing but
// deleting the durable room ever dropped one (#2297).
func TestAnEmptyRoomIsForgottenOnceItHasBeenIdleLongEnough(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h, out := forgetHub(t)
		rm := h.room("quiet")
		rm.mu.Lock()
		rm.music.state.Queue = []protocol.JukeboxEntry{{ID: "1", VideoID: "abc", Title: "Left behind"}}
		rm.mu.Unlock()

		// Well inside the window, the room is still the hub's.
		time.Sleep(roomIdleTTL - time.Minute)
		synctest.Wait()
		if live(h, "quiet") != rm {
			t.Fatalf("forgotten %v early", roomIdleTTL-time.Minute)
		}

		time.Sleep(2 * time.Minute)
		synctest.Wait()
		if got := live(h, "quiet"); got != nil {
			t.Fatalf("still in the hub after %v idle", roomIdleTTL)
		}
		// The map delete alone would leave the goroutine running: the room's
		// own tick is what decides, and the line is written where it returns.
		if !out.says("room forgotten") {
			t.Fatal("the room's tick never reached its exit")
		}
	})
}

// Somebody is in there. The room's clock is the only one the session, the
// timeline and the roster have.
func TestARoomWithALiveSocketIsNotForgotten(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h, _ := forgetHub(t)
		rm := h.room("busy")
		rm.join(sock("jan"))

		time.Sleep(roomIdleTTL + time.Minute)
		synctest.Wait()
		if live(h, "busy") != rm {
			t.Fatalf("forgot a room with a rider standing in it")
		}
	})
}

// Voice is keyed by channel and outlives the sockets (#149), so a room with
// voice participants and no sockets is not empty — somebody is in it talking.
// And when they hang up, the window starts from there rather than from
// whenever the last tab closed.
func TestARoomWithVoiceAndNoSocketsIsNotForgotten(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h, _ := forgetHub(t)
		rm := h.room("lounge")
		h.VoiceJoined("lounge", "r-jan|tab-1", "Jan")

		time.Sleep(roomIdleTTL + time.Minute)
		synctest.Wait()
		if live(h, "lounge") != rm {
			t.Fatal("forgot a room with somebody in the voice channel")
		}

		h.VoiceLeft("lounge", "r-jan|tab-1")
		time.Sleep(roomIdleTTL - time.Minute)
		synctest.Wait()
		if live(h, "lounge") != rm {
			t.Fatal("the idle window did not restart when voice emptied")
		}
		time.Sleep(2 * time.Minute)
		synctest.Wait()
		if live(h, "lounge") != nil {
			t.Fatal("still in the hub after the voice channel emptied and the window ran out")
		}
	})
}

// A rider handed the room by holdRoom has not joined with it yet, so the tick
// still sees an empty room. Forgetting it there would leave them in a room
// with no clock and no entry in the hub (#751's shape).
func TestARoomASocketIsArrivingAtIsNotForgotten(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h, _ := forgetHub(t)
		rm := h.holdRoom("arriving")

		time.Sleep(roomIdleTTL + time.Minute)
		synctest.Wait()
		if live(h, "arriving") != rm {
			t.Fatal("forgot a room a socket was still arriving at")
		}

		// The socket gave up before it ever joined: now there is nobody.
		h.releaseRoom("arriving")
		time.Sleep(2 * tickInterval)
		synctest.Wait()
		if live(h, "arriving") != nil {
			t.Fatal("the room outlived the last claim on it")
		}
	})
}

// The re-form path is the whole reason this is safe to do: HandleWS builds the
// room again on the next join, from nothing (ADR-0052).
func TestAForgottenRoomComesBackOnTheNextJoin(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h, _ := forgetHub(t)
		rm := h.room("reform")
		rm.mu.Lock()
		rm.music.state.Queue = []protocol.JukeboxEntry{{ID: "1", VideoID: "abc", Title: "Left behind"}}
		rm.seen["jan"] = protocol.Rider{ID: "jan", Name: "Jan"}
		rm.mu.Unlock()

		time.Sleep(roomIdleTTL + time.Minute)
		synctest.Wait()
		if live(h, "reform") != nil {
			t.Fatal("the idle room was not forgotten")
		}

		fresh := h.holdRoom("reform")
		defer h.releaseRoom("reform")
		if fresh == rm {
			t.Fatal("the rebuilt room is the forgotten room")
		}
		fresh.mu.Lock()
		defer fresh.mu.Unlock()
		if len(fresh.music.state.Queue) != 0 || len(fresh.seen) != 0 {
			t.Fatalf("inherited the forgotten room's state: queue=%v seen=%v",
				fresh.music.state.Queue, fresh.seen)
		}
		// And it is ticking again: a room that came back without its clock is
		// worse than one that stayed gone (#751).
		if fresh.forget == nil {
			t.Fatal("the rebuilt room was never wired to the hub")
		}
	})
}

// A session that has not closed still holds samples nobody has saved, and this
// room's clock is the only thing that will save them (tick.go's closeLocked).
func TestARoomWithAnUnfinishedSessionKeepsItsClock(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h, _ := forgetHub(t)
		rm := h.room("paused")
		rm.mu.Lock()
		rm.session.pick("Openers", "{}", 24*3600)
		rm.session.start(time.Now())
		rm.mu.Unlock()
		time.Sleep(2 * countdownSeconds * time.Second)
		rm.mu.Lock()
		rm.session.pause(time.Now())
		rm.mu.Unlock()

		time.Sleep(roomIdleTTL + time.Minute)
		synctest.Wait()
		if live(h, "paused") != rm {
			t.Fatal("forgot a room whose session is paused, with its samples unsaved")
		}
	})
}
