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

// awaitRoster reads ticks until the roster satisfies want, so a test never
// asserts on the one tick that happened to be in flight when it sent.
func awaitRoster(t *testing.T, conn *websocket.Conn, what string, want func([]protocol.Rider) bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
		var msg protocol.ServerMessage
		err := wsjson.Read(ctx, conn, &msg)
		cancel()
		if err != nil {
			t.Fatalf("read while waiting for %s: %v", what, err)
		}
		if msg.Tick != nil && want(msg.Tick.Roster) {
			return
		}
	}
	t.Fatalf("roster never showed %s", what)
}

func awayOf(roster []protocol.Rider, id string) (bool, bool) {
	for _, r := range roster {
		if r.ID == id {
			return r.Away, true
		}
	}
	return false, false
}

func sendAway(t *testing.T, conn *websocket.Conn, away bool) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	if err := wsjson.Write(ctx, conn, protocol.ClientMessage{Away: &protocol.AwayState{Away: away}}); err != nil {
		t.Fatalf("send away=%v: %v", away, err)
	}
}

func awayServer(t *testing.T) (*Hub, string) {
	t.Helper()
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return h, "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/rooms/velvet"
}

// The whole point of #706: the room can see that someone stepped out, and see
// that they came back.
func TestAwayReachesTheRoom(t *testing.T) {
	_, url := awayServer(t)
	watcher := dial(t, url, "coach:owner")
	stepping := dial(t, url, "kim:member")

	sendAway(t, stepping, true)
	awaitRoster(t, watcher, "kim away", func(roster []protocol.Rider) bool {
		away, ok := awayOf(roster, "kim")
		return ok && away
	})

	sendAway(t, stepping, false)
	awaitRoster(t, watcher, "kim back", func(roster []protocol.Rider) bool {
		away, ok := awayOf(roster, "kim")
		return ok && !away
	})
}

// Away is the rider's, not the socket's: pressing the button on one screen
// marks the person, and closing that screen while another is still open does
// not quietly bring them back.
func TestAwayIsPerRiderNotPerSocket(t *testing.T) {
	_, url := awayServer(t)
	watcher := dial(t, url, "coach:owner")
	desktop := dial(t, url, "kim:member")
	phone := dial(t, url, "kim:member")

	sendAway(t, desktop, true)
	awaitRoster(t, watcher, "kim away", func(roster []protocol.Rider) bool {
		away, ok := awayOf(roster, "kim")
		return ok && away
	})

	// One of two screens closes. Kim is still in the room, so still away.
	_ = desktop.CloseNow()
	sendAway(t, phone, true)
	awaitRoster(t, watcher, "kim still away on the phone", func(roster []protocol.Rider) bool {
		away, ok := awayOf(roster, "kim")
		return ok && away
	})
}

// Away is presence, so it dies with presence — a rider who left away and
// comes back is not greeted as away by a room that remembered.
func TestAwayDoesNotSurviveLeaving(t *testing.T) {
	_, url := awayServer(t)
	watcher := dial(t, url, "coach:owner")
	stepping := dial(t, url, "kim:member")

	sendAway(t, stepping, true)
	awaitRoster(t, watcher, "kim away", func(roster []protocol.Rider) bool {
		away, ok := awayOf(roster, "kim")
		return ok && away
	})

	_ = stepping.CloseNow()
	awaitRoster(t, watcher, "kim gone", func(roster []protocol.Rider) bool {
		_, ok := awayOf(roster, "kim")
		return !ok
	})

	dial(t, url, "kim:member")
	awaitRoster(t, watcher, "kim back and not away", func(roster []protocol.Rider) bool {
		away, ok := awayOf(roster, "kim")
		return ok && !away
	})
}
