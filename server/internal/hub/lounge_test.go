package hub

import (
	"context"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// awaitLounge reads ticks until the lounge on one satisfies want.
func awaitLounge(t *testing.T, conn *websocket.Conn, what string, want func(*protocol.LoungeState) bool) {
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
		if msg.Tick != nil && want(msg.Tick.Lounge) {
			return
		}
	}
	t.Fatalf("the lounge never showed %s", what)
}

func sendLounge(t *testing.T, conn *websocket.Conn, state protocol.LoungeState) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	if err := wsjson.Write(ctx, conn, protocol.ClientMessage{Lounge: &state}); err != nil {
		t.Fatalf("send lounge %+v: %v", state, err)
	}
}

// One rider flips the lamp and the weather, and everyone in the channel sees
// the same room.
func TestLoungeReachesTheChannel(t *testing.T) {
	_, url := awayServer(t)
	watcher := dial(t, url, "coach:owner")
	flipping := dial(t, url, "kim:member")

	sendLounge(t, flipping, protocol.LoungeState{LampOff: true, Weather: "snow"})
	awaitLounge(t, watcher, "the lamp off in snow", func(l *protocol.LoungeState) bool {
		return l != nil && l.LampOff && l.Weather == "snow"
	})
}

func TestSetLounge(t *testing.T) {
	cases := []struct {
		name string
		was  protocol.LoungeState
		want protocol.LoungeState
		got  *protocol.LoungeState
	}{
		{"a known weather", protocol.LoungeState{}, protocol.LoungeState{Weather: "clear"}, &protocol.LoungeState{Weather: "clear"}},
		{"an unknown weather keeps the window", protocol.LoungeState{Weather: "snow"}, protocol.LoungeState{LampOff: true, Weather: "hail"}, &protocol.LoungeState{LampOff: true, Weather: "snow"}},
		{"rain is the default and sends nothing", protocol.LoungeState{Weather: "snow"}, protocol.LoungeState{Weather: "rain"}, nil},
		{"the lamp back on in rain sends nothing", protocol.LoungeState{LampOff: true}, protocol.LoungeState{}, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rm := &channelState{lounge: tc.was}
			rm.setLounge(tc.want)
			got := rm.loungeLocked()
			if (got == nil) != (tc.got == nil) || (got != nil && *got != *tc.got) {
				t.Errorf("lounge = %+v, want %+v", got, tc.got)
			}
		})
	}
}
