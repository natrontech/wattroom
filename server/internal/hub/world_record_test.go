package hub

import (
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// bunchRide rides Team Relay on a cut of lengthM that begins 420 m into the
// stored road, from fromM, ana and ben pedalling, for so many seconds, then
// ends it and hands the close to the saver; it answers what the close handed
// over.
func bunchRide(t *testing.T, lengthM, fromM float64, loop, reverse bool, seconds int) *sessionEnd {
	t.Helper()
	ana, ben := protocol.Rider{ID: "ana", Name: "ana", Role: "member", FtpWatts: 250}, protocol.Rider{ID: "ben", Name: "ben", Role: "member", FtpWatts: 250}
	rm, clients := inChannel(t, "bunch-road", ana, ben)
	now := time.Unix(1_700_000_000, 0)
	rm.now = func() time.Time { return now }
	route := rideOn(slope(0, lengthM), fromM, loop, reverse)
	route.CutFromM = 420
	if refusal := rm.startGameOn("team-relay", route, ana, now); refusal != "" {
		t.Fatalf("start: %s", refusal)
	}
	joinRide(rm, "ana", "ben")
	var ended *sessionEnd
	tick := func() {
		rm.mu.Lock()
		if out := rm.tickLocked(func() time.Time { return now }, time.Second, true); out.ended != nil {
			ended = out.ended
		}
		rm.mu.Unlock()
	}
	for second := range seconds {
		now = now.Add(time.Second)
		rm.setMetrics(clients["ana"], protocol.RiderMetrics{Watts: 250, Seq: second + 1})
		rm.setMetrics(clients["ben"], protocol.RiderMetrics{Watts: 230, Seq: second + 1})
		tick()
	}
	rm.endGame(now)
	now = now.Add(time.Second)
	tick()
	if ended == nil {
		t.Fatal("the session handed the saver nothing")
	}
	return ended
}

// #3738's table: a bunch's riders save every second's metre on the stored
// road — 420 m to 1020 m for this 600 m cut — counting up it, down it when
// the cut is reversed, and over again each lap of a loop; and the road they
// hand over was towed, so it times nothing.
func TestABunchRideStandsOnTheStoredRoad(t *testing.T) {
	for _, c := range []struct {
		name           string
		fromM          float64
		loop, reverse  bool
		down, wraps    bool
		wantFromStored float64
	}{
		{"up the cut", 100, false, false, false, false, 520},
		{"down a reversed cut", 100, false, true, true, false, 920},
		{"round a loop", 100, true, false, false, true, 520},
	} {
		t.Run(c.name, func(t *testing.T) {
			ended := bunchRide(t, 600, c.fromM, c.loop, c.reverse, 150)
			for _, rec := range ended.records {
				road := rec.Road
				if road == nil || !road.Towed || road.RoadHash != "h-home" || road.DistanceM <= 0 {
					t.Fatalf("%s's road: %+v", rec.Rider.ID, road)
				}
				if d := road.FromM - c.wantFromStored; d < -45 || d > 30 {
					t.Errorf("%s started at %.1f m on the stored road, want near %.1f m", rec.Rider.ID, road.FromM, c.wantFromStored)
				}
				ups, downs := 0, 0
				for i, s := range rec.Samples {
					if s.M < 420 || s.M > 1020+1e-6 {
						t.Fatalf("%s's second %d stands at %.1f m, off the stored road's cut", rec.Rider.ID, i, s.M)
					}
					if i > 0 && s.M > rec.Samples[i-1].M {
						ups++
					}
					if i > 0 && s.M < rec.Samples[i-1].M {
						downs++
					}
				}
				if c.down && (ups > 2 || downs == 0) || !c.down && !c.wraps && (downs > 2 || ups == 0) {
					t.Errorf("%s moved up %d and down %d times, want mostly %s", rec.Rider.ID, ups, downs, map[bool]string{true: "down", false: "up"}[c.down])
				}
				if c.wraps && (downs == 0 || downs > 4) {
					t.Errorf("%s came round the loop %d times in 150 s", rec.Rider.ID, downs)
				}
			}
		})
	}
}
