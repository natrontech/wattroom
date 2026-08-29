package hub

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"log/slog"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// fakeAccess admits riders by an X-Rider header: "name:role", refusing others —
// standing in for rooms.Service so this tests the hub, not the database.
type fakeAccess struct{}

func (fakeAccess) Authorize(r *http.Request, _ string) (protocol.Rider, error) {
	v := r.Header.Get("X-Rider")
	if v == "" {
		return protocol.Rider{}, errors.New("no rider")
	}
	name, role, _ := strings.Cut(v, ":")
	return protocol.Rider{ID: name, Name: name, Role: role, FtpWatts: 250}, nil
}

func dial(t *testing.T, url, rider string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	conn, res, err := websocket.Dial(ctx, url, &websocket.DialOptions{
		HTTPHeader: http.Header{"X-Rider": []string{rider}},
	})
	if res != nil && res.Body != nil {
		defer func() { _ = res.Body.Close() }()
	}
	if err != nil {
		t.Fatalf("dial as %q: %v", rider, err)
	}
	t.Cleanup(func() { _ = conn.CloseNow() })
	return conn
}

func readTick(t *testing.T, conn *websocket.Conn) protocol.ServerTick {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
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
	t.Fatalf("no tick within deadline")
	return protocol.ServerTick{}
}

func TestWebSocketRoom(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/rooms/velvet"

	// The privacy property: no membership, no socket.
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	_, res, err := websocket.Dial(ctx, url, nil)
	if res != nil && res.Body != nil {
		defer func() { _ = res.Body.Close() }()
	}
	if err == nil || res == nil || res.StatusCode != http.StatusForbidden {
		t.Fatalf("stranger was not refused with 403 (err %v)", err)
	}

	coach := dial(t, url, "jan:owner")
	member := dial(t, url, "sven:member")

	// Metrics flow into the coalesced tick, and the roster carries both riders.
	if err := wsjson.Write(t.Context(), member, protocol.ClientMessage{
		Metrics: &protocol.RiderMetrics{Watts: 210, Cadence: 88, Seq: 1},
	}); err != nil {
		t.Fatalf("send metrics: %v", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	var tick protocol.ServerTick
	for {
		tick = readTick(t, coach)
		if _, ok := tick.Riders["sven"]; ok || time.Now().After(deadline) {
			break
		}
	}
	if tick.Riders["sven"].Watts != 210 {
		t.Fatalf("member metrics did not reach the tick: %+v", tick.Riders)
	}
	if len(tick.Roster) != 2 {
		t.Fatalf("roster: %+v", tick.Roster)
	}
	if tick.State.Phase != "idle" {
		t.Fatalf("phase: %q", tick.State.Phase)
	}

	// A member's control is refused with an error message, not silently eaten.
	if err := wsjson.Write(t.Context(), member, protocol.ClientMessage{
		Control: &protocol.Control{Action: "start"},
	}); err != nil {
		t.Fatalf("send control: %v", err)
	}
	readCtx, readCancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer readCancel()
	var refused protocol.ServerMessage
	for {
		if err := wsjson.Read(readCtx, member, &refused); err != nil {
			t.Fatalf("read refusal: %v", err)
		}
		if refused.Error != nil {
			break
		}
	}
	if refused.Error.Code != "forbidden" {
		t.Fatalf("member control: %+v", refused.Error)
	}

	// The coach picks and starts; the tick's shared state moves to countdown.
	for _, control := range []protocol.Control{
		{Action: "pick", WorkoutName: "Openers", WorkoutJSON: "{}", TotalSeconds: 120},
		{Action: "start"},
	} {
		if err := wsjson.Write(t.Context(), coach, protocol.ClientMessage{Control: &control}); err != nil {
			t.Fatalf("coach control: %v", err)
		}
	}
	deadline = time.Now().Add(5 * time.Second)
	for {
		tick = readTick(t, coach)
		if tick.State.Phase == "countdown" || time.Now().After(deadline) {
			break
		}
	}
	if tick.State.Phase != "countdown" || tick.State.WorkoutName != "Openers" {
		t.Fatalf("state after start: %+v", tick.State)
	}
}

func TestRosterDeduplicatesRiders(t *testing.T) {
	// The same rider on two devices is one presence: duplicate roster ids are
	// poison to keyed rendering, and this crashed the dashboard before it was
	// deduped (found live, then pinned here).
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/rooms/dupes"

	first := dial(t, url, "jan:owner")
	dial(t, url, "jan:owner") // same rider, second device

	tick := readTick(t, first)
	if len(tick.Roster) != 1 {
		t.Fatalf("expected one roster entry for one rider on two sockets, got %d", len(tick.Roster))
	}
}
