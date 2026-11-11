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
	name := "Thursday Crew"
	for _, c := range []struct {
		what string
		ride db.GetRideForUploadRow
		want string
	}{
		{"solo", db.GetRideForUploadRow{}, "Ridden on https://wattroom.ch"},
		{"with a crew", db.GetRideForUploadRow{CrewName: &name}, "Ridden with Thursday Crew on https://wattroom.ch"},
	} {
		if got := activityDescription(c.ride); got != c.want {
			t.Errorf("%s: %q, want %q", c.what, got, c.want)
		}
	}
}
