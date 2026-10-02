package hub

import (
	"math"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// gameOnRoad starts mode on a flat road (route non-nil) or off one, with ana
// and ben at FTP 250 riding watts(second) each, and ticks it so many seconds.
func gameOnRoad(t *testing.T, mode string, route *routeRide, seconds int, watts func(rm *channelState, second int) (ana, ben int)) (*channelState, time.Time) {
	t.Helper()
	ana := protocol.Rider{ID: "ana", Name: "ana", Role: "member", FtpWatts: 250}
	ben := protocol.Rider{ID: "ben", Name: "ben", Role: "member", FtpWatts: 250}
	rm, clients := inChannel(t, "game-road", ana, ben)
	now := time.Unix(1_700_000_000, 0)
	if refusal := rm.startGameOn(mode, route, 0, ana, now); refusal != "" {
		t.Fatalf("start %s: %s", mode, refusal)
	}
	joinRide(rm, "ana", "ben")
	for second := range seconds {
		now = now.Add(time.Second)
		a, b := watts(rm, second)
		rm.setMetrics(clients["ana"], protocol.RiderMetrics{Watts: a, Seq: second + 1})
		rm.setMetrics(clients["ben"], protocol.RiderMetrics{Watts: b, Seq: second + 1})
		rm.mu.Lock()
		rm.tickLocked(func() time.Time { return now }, time.Second, false)
		rm.mu.Unlock()
	}
	return rm, now
}

// #3114: on a road the bunch rides what the game asks of everyone — a
// ramp's line, Floor is Lava's called zone — where a game with no plan would
// ride the riders' mean.
func TestARoadGameRidesWhatItsModeAsks(t *testing.T) {
	const seconds = 50
	ref := float64(protocol.ReferenceRiderWatts)
	// Both riders at 120 % FTP: the mean the bunch would otherwise ride.
	strong := func(*channelState, int) (int, int) { return 300, 300 }
	// Floor is Lava's riders hold the called zone, a point above its floor:
	// inside it, so the game runs, and never its middle.
	zone := func(rm *channelState) int { return rm.game.state(time.Time{}).CalledZone }
	holding := func(rm *channelState, _ int) (int, int) {
		w := int(math.Ceil((zoneBounds[zone(rm)][0] + 0.01) * 250))
		return w, w
	}
	for _, c := range []struct {
		mode  string
		watts func(rm *channelState, second int) (int, int)
		pct   func(rm *channelState) float64
	}{
		{"backyard-ramp", strong, func(*channelState) float64 { return 0.80 }},
		{"collective-ramp", strong, func(*channelState) float64 { return 0.75 }},
		{"floor-is-lava", holding, func(rm *channelState) float64 {
			return (zoneBounds[zone(rm)][0] + zoneBounds[zone(rm)][1]) / 2
		}},
		// No ask: the mean, as before.
		{"watt-golf", strong, func(*channelState) float64 { return 1.2 }},
	} {
		t.Run(c.mode, func(t *testing.T) {
			rm, _ := gameOnRoad(t, c.mode, rideOn(slope(0, 200_000), 0, false, false), seconds, c.watts)
			pct := c.pct(rm)
			want := referencePace(seconds, func(int) float64 { return pct * ref }, func(float64) float64 { return 0 })
			if got := bunchAt(rm); math.Abs(got-want.Distance) > 0.01 {
				t.Fatalf("the bunch rode %.2f m, want %.2f m at %.0f %% FTP", got, want.Distance, pct*100)
			}
		})
	}
}

// #3114's acceptance: every mode still runs without a road.
func TestEveryGameStillRunsWithoutARoad(t *testing.T) {
	for mode := range gameModeNames {
		if isRace(mode) {
			continue // a race rides only a road of its own (ADR-0067)
		}
		t.Run(mode, func(t *testing.T) {
			rm, now := gameOnRoad(t, mode, nil, 30, func(*channelState, int) (int, int) { return 200, 180 })
			if rm.session.bunch != nil {
				t.Fatal("a game off a road rode a bunch")
			}
			// Running, or ended by its own rules (a ramp or Lava may put ben out).
			if s := rm.game.state(now); s.Mode != mode || (s.Phase != "running" && s.Phase != "done") {
				t.Fatalf("state %q %q, want %q running or done", s.Mode, s.Phase, mode)
			}
		})
	}
}
