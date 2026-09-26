package hub

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// A session control was the one input with no throttle (#3019): a member
// could loop a 64 KiB pick and the room re-validated every one. Now the same
// control inside controlMinGap is refused with rate_limited — from a second
// tab too — while a coach's cadence is not: the start the client sends right
// behind its own pick is another control and lands, and so does the same
// control again once the gap has passed.
func TestSessionControlsAreThrottledPerRiderAndControl(t *testing.T) {
	var clock atomic.Int64
	clock.Store(time.Unix(1_700_000_000, 0).UnixNano())
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	h.now = func() time.Time { return time.Unix(0, clock.Load()) } // before any room exists
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/channels/velvet"

	rm := h.room("velvet")
	tab := dial(t, url, "jan:owner")
	otherTab := dial(t, url, "jan:owner")
	eventually(t, "both of jan's tabs joined", func() bool {
		rm.mu.Lock()
		defer rm.mu.Unlock()
		return len(rm.clients) == 2
	})

	send := func(conn *websocket.Conn, ctl protocol.Control) {
		t.Helper()
		if err := wsjson.Write(t.Context(), conn, protocol.ClientMessage{Control: &ctl}); err != nil {
			t.Fatalf("send %s: %v", ctl.Action, err)
		}
	}
	pick := func(name string) protocol.Control {
		return protocol.Control{Action: "pick", WorkoutName: name, WorkoutJSON: wsWorkout, TotalSeconds: 120}
	}

	// The clock does not move until the test moves it, so everything up to
	// the Add below happens inside one gap.
	send(tab, pick("Openers"))
	awaitFrame(t, tab, "the first pick on the tick", func(msg protocol.ServerMessage) bool {
		return msg.Tick != nil && msg.Tick.State.WorkoutName == "Openers"
	})

	// A burst: the same control again is refused, and says so.
	send(tab, pick("Burst"))
	refused := awaitFrame(t, tab, "the repeated pick refused", func(msg protocol.ServerMessage) bool {
		return msg.Error != nil
	})
	if refused.Error.Code != "rate_limited" || refused.Error.Message == "" {
		t.Fatalf("a repeated pick inside the gap answered %+v, want rate_limited with a message", refused.Error)
	}
	// The allowance is the rider's, not the socket's: another tab is no way round it.
	send(otherTab, pick("Burst"))
	refused = awaitFrame(t, otherTab, "the second tab's pick refused", func(msg protocol.ServerMessage) bool {
		return msg.Error != nil
	})
	if refused.Error.Code != "rate_limited" {
		t.Fatalf("a second tab's pick inside the gap answered %+v, want rate_limited", refused.Error)
	}

	// A coach's cadence: past the gap a pick lands again, and the start the
	// client sends straight behind it, at the same instant, lands with it.
	clock.Add(int64(controlMinGap))
	send(tab, pick("Tempo"))
	send(tab, protocol.Control{Action: "start"})
	awaitFrame(t, tab, "the new pick counting down", func(msg protocol.ServerMessage) bool {
		return msg.Tick != nil && msg.Tick.State.Phase == "countdown" && msg.Tick.State.WorkoutName == "Tempo"
	})

	// A word outside the vocabulary is refused before it can become a key.
	send(tab, protocol.Control{Action: "stop"})
	refused = awaitFrame(t, tab, "the unknown control refused", func(msg protocol.ServerMessage) bool {
		return msg.Error != nil
	})
	if refused.Error.Code != "validation_error" {
		t.Fatalf("an unknown control answered %+v, want validation_error", refused.Error)
	}
	rm.mu.Lock()
	defer rm.mu.Unlock()
	for key := range rm.lastInput {
		if strings.Contains(key, "stop") {
			t.Fatalf("an unknown control became an allowance: %q", key)
		}
	}
}

// awaitFrame reads conn until want accepts a frame. Any refusal want does not
// accept fails the test — so does a tick carrying the refused "Burst" pick,
// since a refusal that still ran would be no throttle at all.
func awaitFrame(t *testing.T, conn *websocket.Conn, what string, want func(protocol.ServerMessage) bool) protocol.ServerMessage {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	for {
		var msg protocol.ServerMessage
		if err := wsjson.Read(ctx, conn, &msg); err != nil {
			t.Fatalf("%s: never arrived: %v", what, err)
		}
		if msg.Tick != nil && msg.Tick.State.WorkoutName == "Burst" {
			t.Fatalf("%s: a refused pick ran anyway: %+v", what, msg.Tick.State)
		}
		if want(msg) {
			return msg
		}
		if msg.Error != nil {
			t.Fatalf("%s: refused instead: %+v", what, msg.Error)
		}
	}
}
