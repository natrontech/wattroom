package strava

import (
	"testing"

	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// An activity is titled by what was ridden (#3055): a workout by its own
// name, over a road too. A ride the road alone names carries no place,
// generated or not (#4154, ADR-0063): saved under a generated name that
// names one, it goes out as a virtual route ride and its distance.
func TestActivityName(t *testing.T) {
	key, km, zero, yes, no := "road-hash", int32(52_940), int32(0), true, false
	named := "Road · " + testx.Corridor.Places[0] + " · 52.9 km"
	own := "Sweet spot"
	for _, c := range []struct {
		what string
		ride db.GetRideForUploadRow
		want string
	}{
		{"a workout", db.GetRideForUploadRow{WorkoutName: "Sweet spot"}, "Sweet spot"},
		{"a workout over a road", db.GetRideForUploadRow{WorkoutName: named, WorkoutOwnName: &own, RouteKey: &key, OnRoad: &yes, DistanceM: &km}, "Sweet spot"},
		{"a route ride", db.GetRideForUploadRow{WorkoutName: named, RouteKey: &key, DistanceM: &km}, "Virtual route ride · 52.9 km"},
		{"a route ride never replayed", db.GetRideForUploadRow{WorkoutName: named, RouteKey: &key}, "Virtual route ride"},
		{"a route ride that went nowhere", db.GetRideForUploadRow{WorkoutName: named, OnRoad: &yes, DistanceM: &zero}, "Virtual route ride"},
		{"a road ride the save never placed", db.GetRideForUploadRow{WorkoutName: named, OnRoad: &yes}, "Virtual route ride"},
		{"a workout off any road", db.GetRideForUploadRow{WorkoutName: "Sweet spot", OnRoad: &no}, "Sweet spot"},
		// WattRoom's own roads are invented (#4248): one names its ride.
		{"a free ride on WattRoom's road", db.GetRideForUploadRow{WorkoutName: "Kettental-Runde", OnRoad: &yes, DistanceM: &km}, "Kettental-Runde"},
		{"a session on WattRoom's road", db.GetRideForUploadRow{WorkoutName: "Col de Berne", RouteKey: &key, OnRoad: &yes, DistanceM: &km}, "Col de Berne"},
		{"a workout on WattRoom's road", db.GetRideForUploadRow{WorkoutName: "Kettental-Runde", WorkoutOwnName: &own, OnRoad: &yes}, "Sweet spot"},
	} {
		got := activityName(c.ride)
		if leak := testx.Leak(got); got != c.want || leak != "" {
			t.Errorf("%s: %q (leaks %q), want %q", c.what, got, leak, c.want)
		}
	}
}

// The activity names the crew it was ridden with (#2443) and links only the
// site: a Strava activity is often public, so no crew link or id (#4139).
// Nobody else's name is ever in it.
func TestActivityDescription(t *testing.T) {
	name, own, yes := "Thursday Crew", "Sweet spot", true
	named := "Road · " + testx.Corridor.Places[0] + " · 52.9 km"
	for _, c := range []struct {
		what string
		ride db.GetRideForUploadRow
		want string
	}{
		{"solo", db.GetRideForUploadRow{}, "Ridden on https://wattroom.ch"},
		{"with a crew", db.GetRideForUploadRow{CrewName: &name}, "Ridden with Thursday Crew on https://wattroom.ch"},
		// A workout titles the activity, so the road it rode is said here,
		// when it is one of WattRoom's own (#4248)...
		{"a workout on WattRoom's road", db.GetRideForUploadRow{WorkoutName: "Kettental-Runde", WorkoutOwnName: &own, OnRoad: &yes},
			"On Kettental-Runde\nRidden on https://wattroom.ch"},
		{"a crew's workout on WattRoom's road", db.GetRideForUploadRow{WorkoutName: "Col de Berne", WorkoutOwnName: &own, OnRoad: &yes, CrewName: &name},
			"On Col de Berne\nRidden with Thursday Crew on https://wattroom.ch"},
		// ...never when the road is the title already, and never a rider's own
		// route, generated name or not (ADR-0063).
		{"a free ride on WattRoom's road", db.GetRideForUploadRow{WorkoutName: "Kettental-Runde", OnRoad: &yes}, "Ridden on https://wattroom.ch"},
		{"a workout on a rider's route", db.GetRideForUploadRow{WorkoutName: named, WorkoutOwnName: &own, OnRoad: &yes}, "Ridden on https://wattroom.ch"},
	} {
		got := activityDescription(c.ride)
		if leak := testx.Leak(got); got != c.want || leak != "" {
			t.Errorf("%s: %q (leaks %q), want %q", c.what, got, leak, c.want)
		}
	}
}
