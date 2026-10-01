package hub

import (
	"math"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// #3722: a race hands the saver each racer's ride along its road — the
// session's route, how far they rode and climbed in the stored road's metres,
// their shelter and whether WattRoom held their watts — and every second of
// their record stands where the race had them, never going back.
func TestARaceHandsTheSaverEachRidersRoad(t *testing.T) {
	r := raceOn(t, 600, racer("ana", 70), racer("ben", 70))
	r.saving = true
	r.rm.setDrive(r.clients["ben"], protocol.Drive{ErgByRoad: true})
	r.ride(10+protocol.RaceNeutralSeconds+120, watts(map[string]int{"ana": 250, "ben": 250}))
	if r.ended == nil || len(r.ended.records) != 2 {
		t.Fatalf("the close handed the saver %+v", r.ended)
	}
	start := float64(protocol.RouteHiddenEndM)
	for _, rec := range r.ended.records {
		road := rec.Road
		if road == nil || road.RouteID != "home" || road.RoadHash != "h-home" || road.FromM != start ||
			math.Abs(road.DistanceM-600) > 1e-6 || road.ErgByRoad != (rec.Rider.ID == "ben") {
			t.Fatalf("%s's road: %+v", rec.Rider.ID, road)
		}
		last := 0.0
		for i, s := range rec.Samples {
			if s.M < start || s.M < last {
				t.Fatalf("%s's second %d stands at %.1f m after %.1f m", rec.Rider.ID, i, s.M, last)
			}
			last = s.M
		}
		if math.Abs(last-(start+600)) > 1e-6 {
			t.Errorf("%s's record ends at %.1f m, want the line at %.1f m", rec.Rider.ID, last, start+600)
		}
	}
}
