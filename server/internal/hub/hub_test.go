package hub

import (
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

func TestRoomMetricsCoalescing(t *testing.T) {
	rm := &room{
		slug:    "test",
		clients: make(map[*client]struct{}),
		metrics: make(map[string]protocol.RiderMetrics),
	}

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
	rm := &room{
		slug:    "test",
		clients: make(map[*client]struct{}),
		metrics: make(map[string]protocol.RiderMetrics),
	}
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
