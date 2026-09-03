package hub

import (
	"slices"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// screen is one of a rider's tabs, with the tab label a real client sends.
func screen(riderID, tab, device string) *client {
	return &client{rider: protocol.Rider{ID: riderID}, tab: tab, device: device}
}

func claim(kinds ...string) protocol.SensorClaim {
	return protocol.SensorClaim{Held: kinds}
}

func TestClaimSensorsFirstScreenWins(t *testing.T) {
	tests := []struct {
		name string
		// Applied in order, each from the named screen.
		steps []struct {
			tab    string
			device string
			claim  protocol.SensorClaim
		}
		// What the phone and the desktop each end up holding.
		wantPhone     []string
		wantDesktop   []string
		wantElsewhere map[string]string // as seen by the DESKTOP
	}{
		{
			name: "unclaimed kinds go to whoever asks",
			steps: []struct {
				tab    string
				device string
				claim  protocol.SensorClaim
			}{
				{"t1", "phone", claim("trainer", "heart-rate")},
			},
			wantPhone:     []string{"heart-rate", "trainer"},
			wantElsewhere: map[string]string{"trainer": "phone", "heart-rate": "phone"},
		},
		{
			name: "the second screen is refused what the first holds",
			steps: []struct {
				tab    string
				device string
				claim  protocol.SensorClaim
			}{
				{"t1", "phone", claim("trainer")},
				{"t2", "desktop", claim("trainer")},
			},
			wantPhone:     []string{"trainer"},
			wantDesktop:   nil,
			wantElsewhere: map[string]string{"trainer": "phone"},
		},
		{
			name: "different kinds live on different screens",
			steps: []struct {
				tab    string
				device string
				claim  protocol.SensorClaim
			}{
				{"t1", "phone", claim("heart-rate")},
				{"t2", "desktop", claim("trainer")},
			},
			wantPhone:     []string{"heart-rate"},
			wantDesktop:   []string{"trainer"},
			wantElsewhere: map[string]string{"heart-rate": "phone"},
		},
		{
			name: "dropping a kind frees it for the other screen",
			steps: []struct {
				tab    string
				device string
				claim  protocol.SensorClaim
			}{
				{"t1", "phone", claim("trainer")},
				{"t2", "desktop", claim("trainer")}, // refused
				{"t1", "phone", claim()},            // Forget on the phone
				{"t2", "desktop", claim("trainer")}, // now granted
			},
			wantPhone:   nil,
			wantDesktop: []string{"trainer"},
		},
		{
			name: "unknown kinds are dropped rather than stored",
			steps: []struct {
				tab    string
				device string
				claim  protocol.SensorClaim
			}{
				{"t1", "phone", claim("trainer", "toaster")},
			},
			wantPhone:     []string{"trainer"},
			wantElsewhere: map[string]string{"trainer": "phone"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rm := newRoom("test")
			phone := screen("jan", "t1", "phone")
			desktop := screen("jan", "t2", "desktop")
			rm.join(phone)
			rm.join(desktop)

			for _, step := range tt.steps {
				c := phone
				if step.tab == "t2" {
					c = desktop
				}
				step.claim.Tab = step.tab
				step.claim.Device = step.device
				rm.claimSensors(c, step.claim)
			}

			rm.mu.Lock()
			gotPhone := rm.pairingForLocked(phone)
			gotDesktop := rm.pairingForLocked(desktop)
			rm.mu.Unlock()

			if !slices.Equal(gotPhone.Held, tt.wantPhone) {
				t.Errorf("phone holds %v, want %v", gotPhone.Held, tt.wantPhone)
			}
			if !slices.Equal(gotDesktop.Held, tt.wantDesktop) {
				t.Errorf("desktop holds %v, want %v", gotDesktop.Held, tt.wantDesktop)
			}
			for kind, device := range tt.wantElsewhere {
				if got := gotDesktop.Elsewhere[kind]; got != device {
					t.Errorf("desktop sees %s on %q, want %q", kind, got, device)
				}
			}
		})
	}
}

func TestReloadReclaimsItsOwnSensor(t *testing.T) {
	// A refresh opens a new socket while the old one is still registered —
	// the hub reaps it only when the read loop returns. Keyed by socket, the
	// reloaded tab would be "another device" and would sit there unable to
	// pair the trainer it is still physically connected to. The tab label is
	// what makes it its own successor.
	rm := newRoom("test")
	before := screen("jan", "t1", "desktop")
	rm.join(before)
	rm.claimSensors(before, protocol.SensorClaim{Held: []string{"trainer"}, Tab: "t1", Device: "desktop"})

	after := screen("jan", "t1", "desktop") // same tab, new socket
	rm.join(after)
	rm.claimSensors(after, protocol.SensorClaim{Held: []string{"trainer"}, Tab: "t1", Device: "desktop"})

	rm.mu.Lock()
	got := rm.pairingForLocked(after)
	owns := rm.ownsTrainerLocked(after)
	rm.mu.Unlock()

	if !slices.Equal(got.Held, []string{"trainer"}) {
		t.Errorf("the reloaded tab holds %v, want the trainer back", got.Held)
	}
	if len(got.Elsewhere) != 0 {
		t.Errorf("the reloaded tab was told its own sensor is elsewhere: %v", got.Elsewhere)
	}
	if !owns {
		t.Error("the reloaded tab may not send metrics for a trainer it holds")
	}
}

func TestTablessScreensStillArbitrate(t *testing.T) {
	// A browser with sessionStorage blocked sends no tab label at all. The
	// hub must fall back to identifying the socket rather than treating every
	// such screen as the same one — otherwise two private-window tabs would
	// both pass the metrics gate and the double-stream bug would be back
	// exactly where nobody would think to look for it.
	rm := newRoom("test")
	first := &client{rider: protocol.Rider{ID: "jan"}}
	second := &client{rider: protocol.Rider{ID: "jan"}}
	rm.join(first)
	rm.join(second)

	rm.claimSensors(first, protocol.SensorClaim{Held: []string{"trainer"}, Device: "desktop"})
	rm.claimSensors(second, protocol.SensorClaim{Held: []string{"trainer"}, Device: "desktop"})

	rm.mu.Lock()
	firstOwns, secondOwns := rm.ownsTrainerLocked(first), rm.ownsTrainerLocked(second)
	rm.mu.Unlock()

	if !firstOwns {
		t.Error("the screen that claimed first lost its own trainer")
	}
	if secondOwns {
		t.Error("a second tab passed the metrics gate — two streams, one rider")
	}
}

func TestAHostileClaimStaysBounded(t *testing.T) {
	// WS input is untrusted: a claim must not be able to grow room state.
	rm := newRoom("test")
	c := &client{rider: protocol.Rider{ID: "jan"}}
	rm.join(c)

	junk := make([]string, 5_000)
	for i := range junk {
		junk[i] = "kind-" + string(rune('a'+i%26))
	}
	rm.claimSensors(c, protocol.SensorClaim{
		Held:   junk,
		Tab:    strings.Repeat("t", 10_000),
		Device: strings.Repeat("d", 10_000),
	})

	rm.mu.Lock()
	held := len(rm.claims["jan"])
	tab, device := len(c.tab), len(c.device)
	rm.mu.Unlock()

	if held != 0 {
		t.Errorf("invented kinds reached room state: %d held", held)
	}
	if tab > 64 || device > 16 {
		t.Errorf("unbounded labels stored: tab %d, device %d", tab, device)
	}
}

func TestClaimIsScopedToOneRider(t *testing.T) {
	// Two people pair a trainer each; neither may block the other, and
	// neither is told about the other's equipment.
	rm := newRoom("test")
	jan := screen("jan", "t1", "desktop")
	kai := screen("kai", "t2", "desktop")
	rm.join(jan)
	rm.join(kai)

	rm.claimSensors(jan, protocol.SensorClaim{Held: []string{"trainer"}, Tab: "t1", Device: "desktop"})
	rm.claimSensors(kai, protocol.SensorClaim{Held: []string{"trainer"}, Tab: "t2", Device: "desktop"})

	rm.mu.Lock()
	gotJan := rm.pairingForLocked(jan)
	gotKai := rm.pairingForLocked(kai)
	janOwns, kaiOwns := rm.ownsTrainerLocked(jan), rm.ownsTrainerLocked(kai)
	rm.mu.Unlock()

	if !slices.Equal(gotJan.Held, []string{"trainer"}) || !slices.Equal(gotKai.Held, []string{"trainer"}) {
		t.Fatalf("both riders should hold their own trainer: jan %v, kai %v", gotJan.Held, gotKai.Held)
	}
	if len(gotJan.Elsewhere) != 0 || len(gotKai.Elsewhere) != 0 {
		t.Errorf("one rider's kit leaked to the other: jan %v, kai %v", gotJan.Elsewhere, gotKai.Elsewhere)
	}
	if !janOwns || !kaiOwns {
		t.Errorf("both must be allowed to ride: jan %v, kai %v", janOwns, kaiOwns)
	}
}

func TestMetricsOnlyFromTheScreenHoldingTheTrainer(t *testing.T) {
	rm := newRoom("test")
	phone := screen("jan", "t1", "phone")
	desktop := screen("jan", "t2", "desktop")
	rm.join(phone)
	rm.join(desktop)

	// No claim anywhere: an older client still rides.
	rm.setMetrics(desktop, protocol.RiderMetrics{Watts: 111, Seq: 1})
	if got := rm.metrics["jan"].Watts; got != 111 {
		t.Fatalf("with no claim the sample must land, got %d W", got)
	}

	rm.claimSensors(phone, protocol.SensorClaim{Held: []string{"trainer"}, Tab: "t1", Device: "phone"})

	// The desktop is not the holder — its samples must not reach the room,
	// the ride record or the sprint.
	rm.setMetrics(desktop, protocol.RiderMetrics{Watts: 999, Seq: 1})
	if got := rm.metrics["jan"].Watts; got != 111 {
		t.Errorf("a second screen overwrote the ride: got %d W, want the phone's", got)
	}
	rm.setMetrics(phone, protocol.RiderMetrics{Watts: 222, Seq: 2})
	if got := rm.metrics["jan"].Watts; got != 222 {
		t.Errorf("the holder's sample was dropped: got %d W", got)
	}
}

func TestClosingATabFreesItsSensors(t *testing.T) {
	rm := newRoom("test")
	phone := screen("jan", "t1", "phone")
	desktop := screen("jan", "t2", "desktop")
	rm.join(phone)
	rm.join(desktop)
	rm.claimSensors(phone, protocol.SensorClaim{Held: []string{"trainer"}, Tab: "t1", Device: "phone"})

	rm.leave(phone)

	rm.mu.Lock()
	free := rm.ownsTrainerLocked(desktop)
	queued := len(rm.pendingPairing)
	rm.mu.Unlock()
	if !free {
		t.Error("the trainer stayed claimed by a socket that is gone")
	}
	if queued == 0 {
		t.Error("the remaining screen was never told the trainer is free")
	}
}
