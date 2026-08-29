package hub

import (
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

func TestRoomMetricsCoalescing(t *testing.T) {
	rm := newRoom("test")

	tests := []struct {
		name    string
		samples map[string][]protocol.RiderMetrics
		want    map[string]int // rider -> expected watts after coalescing
	}{
		{
			name: "latest sample wins within a tick",
			samples: map[string][]protocol.RiderMetrics{
				"jan": {{Watts: 200, Seq: 1}, {Watts: 250, Seq: 2}},
			},
			want: map[string]int{"jan": 250},
		},
		{
			name: "riders are independent",
			samples: map[string][]protocol.RiderMetrics{
				"jan": {{Watts: 300, Seq: 3}},
				"kai": {{Watts: 180, Seq: 1}},
			},
			want: map[string]int{"jan": 300, "kai": 180},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rm.metrics = make(map[string]protocol.RiderMetrics)
			for rider, samples := range tt.samples {
				for _, s := range samples {
					rm.setMetrics(rider, s)
				}
			}
			for rider, watts := range tt.want {
				if got := rm.metrics[rider].Watts; got != watts {
					t.Errorf("rider %s: got %d watts, want %d", rider, got, watts)
				}
			}
		})
	}
}

func TestLeaveRemovesMetrics(t *testing.T) {
	rm := newRoom("test")
	c := &client{rider: protocol.Rider{ID: "jan"}}
	rm.join(c)
	rm.setMetrics("jan", protocol.RiderMetrics{Watts: 200})
	rm.leave(c)
	if _, ok := rm.metrics["jan"]; ok {
		t.Error("metrics for departed rider should be removed")
	}
}

func TestControlNeedsRole(t *testing.T) {
	// The role check lives in HandleWS; what the room guarantees is that a
	// control only lands through control(), which the handler role-gates. This
	// pins the helper the gate depends on.
	for role, want := range map[string]bool{"owner": true, "coach": true, "member": false, "": false} {
		if got := canControl(role); got != want {
			t.Errorf("canControl(%q) = %v", role, got)
		}
	}
}

func TestAccumulatorDedupesAcrossLiveAndBackfill(t *testing.T) {
	// The crash-safety property (#19): live samples and a reconnect's replay
	// arrive through different doors but land in one record, deduped by seq —
	// resending is always safe and never double-counts.
	rm := newRoom("test")
	rm.session.pick("Openers", "{}", 600)
	rm.session.start(time.Unix(0, 0))
	rm.session.state(time.Unix(20, 0)) // roll countdown into running

	for seq := 1; seq <= 3; seq++ {
		rm.setMetrics("jan", protocol.RiderMetrics{Watts: 200, Seq: seq})
	}
	// The socket dropped after seq 3; the client replays 2..6 from its buffer.
	rm.backfill("jan", []protocol.RiderMetrics{
		{Watts: 200, Seq: 2}, {Watts: 201, Seq: 3}, {Watts: 202, Seq: 4},
		{Watts: 203, Seq: 5}, {Watts: 204, Seq: 6},
	})
	if got := rm.record.count("jan"); got != 6 {
		t.Fatalf("expected exactly 6 samples after dedupe, got %d", got)
	}

	// A hostile batch cannot grow memory: junk is dropped at the bound.
	rm.backfill("jan", []protocol.RiderMetrics{{Watts: 9999, Seq: 7}})
	if got := rm.record.count("jan"); got != 6 {
		t.Fatalf("out-of-bounds sample was recorded: %d", got)
	}

	// A new session is a new ride.
	rm.control(protocol.Control{Action: "start"}, time.Unix(100, 0))
	if got := rm.record.count("jan"); got != 0 {
		t.Fatalf("record survived a session restart: %d", got)
	}
}

func TestBackfillSurvivesAnIdleRoom(t *testing.T) {
	// After a server restart the room comes back idle; the reconnect replay
	// must still land — dropping it there is exactly the loss #19 prevents.
	rm := newRoom("test")
	rm.backfill("jan", []protocol.RiderMetrics{{Watts: 200, Seq: 1}, {Watts: 201, Seq: 2}})
	if got := rm.record.count("jan"); got != 2 {
		t.Fatalf("idle-room backfill dropped: %d", got)
	}
}

func TestCheerAllowlistAndBound(t *testing.T) {
	rm := newRoom("test")
	for i := 0; i < 50; i++ {
		rm.cheer(protocol.Cheer{Emoji: "🔥", From: "jan"})
	}
	if len(rm.cheers) != 32 {
		t.Fatalf("cheer buffer unbounded: %d", len(rm.cheers))
	}
	if _, ok := cheerEmoji["🔥"]; !ok {
		t.Fatal("allowlist missing the obvious one")
	}
	if _, ok := cheerEmoji["<script>"]; ok {
		t.Fatal("allowlist is not a list")
	}
}
