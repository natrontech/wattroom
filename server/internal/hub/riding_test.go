package hub

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// awaitTick reads ticks until one satisfies want, so a test never asserts on
// the tick that happened to be in flight when it sent. The whole tick rather
// than the roster (awaitRoster, away_test.go): riding is only sound to assert
// on a tick that also proves the sample landed.
func awaitTick(t *testing.T, conn *websocket.Conn, what string, want func(*protocol.ServerTick) bool) *protocol.ServerTick {
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
		if msg.Tick != nil && want(msg.Tick) {
			return msg.Tick
		}
	}
	t.Fatalf("no tick showed %s", what)
	return nil
}

func ridingOf(roster []protocol.Rider, id string) (riding, found bool) {
	for _, r := range roster {
		if r.ID == id {
			return r.Riding, true
		}
	}
	return false, false
}

// pedal sends samples at the given watts until the test ends. A real trainer
// publishes at ~1 Hz whether the cranks turn or not, which is the whole bug
// (#1016): this stands in for one, faster so the test is not slow.
func pedal(t *testing.T, conn *websocket.Conn, watts func() int) {
	t.Helper()
	done := make(chan struct{})
	t.Cleanup(func() { close(done) })
	go func() {
		// Exits with the test: the cleanup above closes done.
		for seq := 1; ; seq++ {
			select {
			case <-done:
				return
			case <-time.After(100 * time.Millisecond):
			}
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			_ = wsjson.Write(ctx, conn, protocol.ClientMessage{
				Metrics: &protocol.RiderMetrics{Watts: watts(), Cadence: 85, Seq: seq},
			})
			cancel()
		}
	}()
}

// The room reads the same word every other surface does (#1016). A paired
// trainer sitting at 0 W is connected, not riding — and the tick has to say
// so, because before this the client decided it from the sample's own watts
// and got a different answer from the friends page.
//
// The 10 s hold is unit-tested against ridingLocked (hub_test.go); this is
// the wire: that the flag is derived from watts at all, and that it reaches
// the roster.
func TestRidingReachesTheRoster(t *testing.T) {
	// The helper is named for its first user; it is a plain WS room server.
	h, url := awayServer(t)
	watcher := dial(t, url, "coach:owner")
	rider := dial(t, url, "kim:member")

	// Atomic: the sender is a goroutine and the test moves the value under it.
	var watts atomic.Int64
	pedal(t, rider, func() int { return int(watts.Load()) })

	// Sound only on a tick that also carries the sample: a rider who has sent
	// nothing yet is not riding either, and would pass a bare negative.
	tick := awaitTick(t, watcher, "kim's 0 W sample", func(tick *protocol.ServerTick) bool {
		_, landed := tick.Riders["kim"]
		return landed
	})
	if riding, found := ridingOf(tick.Roster, "kim"); !found || riding {
		t.Fatalf("riding = %v (found %v), want false — the trainer is on, kim is not pedalling", riding, found)
	}
	// The deploy guard still sees a live trainer, which is the point of
	// keeping the two signals apart: a restart in somebody's rest interval is
	// still a restart mid-session.
	if got := h.ridingCount(); got != 1 {
		t.Fatalf("ridingCount = %v, want 1 — the trainer is connected and talking", got)
	}

	watts.Store(214)
	awaitTick(t, watcher, "kim riding", func(tick *protocol.ServerTick) bool {
		riding, _ := ridingOf(tick.Roster, "kim")
		return riding
	})
}
