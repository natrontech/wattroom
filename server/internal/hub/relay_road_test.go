package hub

import (
	"math"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// relayOnRoad starts Team Relay on a flat road of lengthM with ana and ben,
// FTP 250 each, and rides it for so many seconds: ana alone the first second,
// so she forms the paceline and leads it until the first rotation (60 s at
// the soonest), then each second what send says.
func relayOnRoad(t *testing.T, lengthM float64, seconds int, send func(second int) (ana, ben int, anaHeard bool)) (*channelState, time.Time) {
	t.Helper()
	ana := protocol.Rider{ID: "ana", Name: "ana", Role: "member", FtpWatts: 250}
	ben := protocol.Rider{ID: "ben", Name: "ben", Role: "member", FtpWatts: 250}
	rm, clients := inChannel(t, "relay-road", ana, ben)
	now := time.Unix(1_700_000_000, 0)
	if refusal := rm.startGameOn("team-relay", rideOn(slope(0, lengthM), 0, false, false), 0, ana, now); refusal != "" {
		t.Fatalf("start: %s", refusal)
	}
	joinRide(rm, "ana", "ben")
	for second := range seconds {
		now = now.Add(time.Second)
		a, b, anaHeard := send(second)
		if anaHeard {
			rm.setMetrics(clients["ana"], protocol.RiderMetrics{Watts: a, Seq: second + 1})
		}
		if second > 0 {
			rm.setMetrics(clients["ben"], protocol.RiderMetrics{Watts: b, Seq: second + 1})
		}
		rm.mu.Lock()
		rm.tickLocked(func() time.Time { return now }, time.Second, false)
		rm.mu.Unlock()
	}
	return rm, now
}

// #3030's table: on a road the front rider sets the pace — the reference
// rider's speed at their %FTP, on the grade under the paceline — where a
// game with no plan would ride everyone's mean.
func TestARouteRelayRidesAtTheFrontRidersPercent(t *testing.T) {
	const seconds = 50
	ref := float64(protocol.ReferenceRiderWatts)
	for _, c := range []struct {
		name string
		send func(second int) (ana, ben int, anaHeard bool)
		want func(second int) float64 // the reference rider's watts
	}{
		{
			"at the front rider's %FTP, not the mean",
			func(int) (int, int, bool) { return 250, 137, true },
			func(int) float64 { return 1.0 * ref },
		},
		{
			"capped where the bunch caps a rider",
			func(int) (int, int, bool) { return 500, 137, true },
			func(int) float64 { return protocol.BunchMaxPct * ref },
		},
		{
			"at the live mean while the front is silent",
			func(second int) (int, int, bool) { return 250, 200, second == 0 },
			func(second int) float64 {
				if second == 0 {
					return 1.0 * ref
				}
				return 0.8 * ref
			},
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			rm, _ := relayOnRoad(t, 200_000, seconds, c.send)
			want := referencePace(seconds, c.want, func(float64) float64 { return 0 })
			if got := bunchAt(rm); math.Abs(got-want.Distance) > 0.01 {
				t.Fatalf("the bunch rode %.2f m, want %.2f m", got, want.Distance)
			}
		})
	}
}

// The road's length is the target (#3030): the relay ends where the road
// does, and its session with it. 300 m at the reference rider's FTP takes
// about 33 s; 45 s looks while the finished game still lingers (30 s).
func TestARouteRelayFinishesWhereTheRoadDoes(t *testing.T) {
	rm, _ := relayOnRoad(t, 300, 45, func(int) (int, int, bool) { return 250, 137, true })
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if rm.gameDoneAt.IsZero() {
		t.Fatalf("the relay is still running %.0f m along a 300 m road", rm.session.bunch.fromM+rm.session.bunch.pace.Distance)
	}
	if rm.lastGame == nil || rm.lastGame.Phase != "done" {
		t.Fatalf("the relay's last state is %+v, want done", rm.lastGame)
	}
	if rm.session.open() {
		t.Fatal("the relay finished and left its session open")
	}
}
