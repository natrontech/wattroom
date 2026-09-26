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
	h, clock, url := controlHub(t)
	rm := h.room("velvet")
	tab := dial(t, url, "jan:owner")
	otherTab := dial(t, url, "jan:owner")
	eventually(t, "both of jan's tabs joined", func() bool {
		rm.mu.Lock()
		defer rm.mu.Unlock()
		return len(rm.clients) == 2
	})

	// The clock does not move until the test moves it, so everything up to
	// the Add below happens inside one gap.
	sendControl(t, tab, pickControl("Openers"))
	awaitFrame(t, tab, "the first pick on the tick", func(msg protocol.ServerMessage) bool {
		return msg.Tick != nil && msg.Tick.State.WorkoutName == "Openers"
	})

	// A burst: the same control again is refused, and says so.
	sendControl(t, tab, pickControl("Burst"))
	refused := awaitFrame(t, tab, "the repeated pick refused", func(msg protocol.ServerMessage) bool {
		return msg.Error != nil
	})
	if refused.Error.Code != "rate_limited" || refused.Error.Message == "" {
		t.Fatalf("a repeated pick inside the gap answered %+v, want rate_limited with a message", refused.Error)
	}
	// The allowance is the rider's, not the socket's: another tab is no way round it.
	sendControl(t, otherTab, pickControl("Burst"))
	refused = awaitFrame(t, otherTab, "the second tab's pick refused", func(msg protocol.ServerMessage) bool {
		return msg.Error != nil
	})
	if refused.Error.Code != "rate_limited" {
		t.Fatalf("a second tab's pick inside the gap answered %+v, want rate_limited", refused.Error)
	}

	// A coach's cadence: past the gap a pick lands again, and the start the
	// client sends straight behind it, at the same instant, lands with it.
	clock.Add(int64(controlMinGap))
	sendControl(t, tab, pickControl("Tempo"))
	sendControl(t, tab, protocol.Control{Action: "start"})
	awaitFrame(t, tab, "the new pick counting down", func(msg protocol.ServerMessage) bool {
		return msg.Tick != nil && msg.Tick.State.Phase == "countdown" && msg.Tick.State.WorkoutName == "Tempo"
	})

	// A word outside the vocabulary is refused before it can become a key.
	sendControl(t, tab, protocol.Control{Action: "stop"})
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

// Join and leave take no allowance: the session page sends join by itself
// whenever a tick shows its rider out, so a rider with two tabs open sends two
// inside one gap. Throttled, the second answered rate_limited — "That was
// quick" on a tab nobody touched, and a pending start on that tab let go with
// it. Every join and leave here lands inside one gap, from either tab, and
// none of them answers.
func TestSessionJoinAndLeaveTakeNoAllowance(t *testing.T) {
	h, _, url := controlHub(t)
	rm := h.room("velvet")
	coach := dial(t, url, "jan:owner")
	tab := dial(t, url, "ana:member")
	otherTab := dial(t, url, "ana:member")
	eventually(t, "the coach and both of ana's tabs joined", func() bool {
		rm.mu.Lock()
		defer rm.mu.Unlock()
		return len(rm.clients) == 3
	})
	sendControl(t, coach, pickControl("Openers"))
	awaitFrame(t, tab, "the session open", func(msg protocol.ServerMessage) bool {
		return msg.Tick != nil && msg.Tick.State.WorkoutName == "Openers"
	})

	// The clock never moves: all of it is one gap. Each tab's last join is
	// the last word, so ana ends in however the two interleave.
	for _, action := range []string{"join", "leave", "join"} {
		sendControl(t, tab, protocol.Control{Action: action})
		sendControl(t, otherTab, protocol.Control{Action: action})
	}
	// A word outside the vocabulary answers on the socket that sent it, after
	// whatever that socket sent before it: a refused join or leave would reach
	// awaitFrame first and fail it.
	for _, conn := range []*websocket.Conn{tab, otherTab} {
		sendControl(t, conn, protocol.Control{Action: "stop"})
		awaitFrame(t, conn, "every join and leave answered by nothing", func(msg protocol.ServerMessage) bool {
			return msg.Error != nil && msg.Error.Code == "validation_error"
		})
	}
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if !rm.session.rides("ana") {
		t.Fatal("ana's last join inside the gap did not put her on the timeline")
	}
}

// controlHub serves one hub's socket on a clock that moves only when the test
// moves it, so everything between two moves happens inside one controlMinGap.
func controlHub(t *testing.T) (*Hub, *atomic.Int64, string) {
	t.Helper()
	clock := new(atomic.Int64)
	clock.Store(time.Unix(1_700_000_000, 0).UnixNano())
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	h.now = func() time.Time { return time.Unix(0, clock.Load()) } // before any room exists
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return h, clock, "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/channels/velvet"
}

func sendControl(t *testing.T, conn *websocket.Conn, ctl protocol.Control) {
	t.Helper()
	if err := wsjson.Write(t.Context(), conn, protocol.ClientMessage{Control: &ctl}); err != nil {
		t.Fatalf("send %s: %v", ctl.Action, err)
	}
}

func pickControl(name string) protocol.Control {
	return protocol.Control{Action: "pick", WorkoutName: name, WorkoutJSON: wsWorkout, TotalSeconds: 120}
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
