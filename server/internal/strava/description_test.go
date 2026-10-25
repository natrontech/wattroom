package strava

import (
	"testing"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

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
