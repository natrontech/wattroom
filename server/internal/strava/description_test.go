package strava

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The activity names the crew it was ridden with and links to it (#2443); a
// solo ride carries the link alone. Nobody else's name is ever in it.
func TestActivityDescription(t *testing.T) {
	crew, _ := store.ParseUUID("0b6c1f3e-0000-4000-8000-00000000000c")
	name := "Thursday Crew"
	for _, c := range []struct {
		what string
		ride db.GetRideForUploadRow
		want string
	}{
		{"solo", db.GetRideForUploadRow{}, "Ridden on WattRoom — https://wattroom.ch"},
		{"with a crew", db.GetRideForUploadRow{CrewID: crew, CrewName: &name},
			"Ridden with Thursday Crew on WattRoom — https://wattroom.ch/crew/0b6c1f3e-0000-4000-8000-00000000000c"},
		{"a crew since deleted", db.GetRideForUploadRow{CrewID: pgtype.UUID{}, CrewName: nil}, "Ridden on WattRoom — https://wattroom.ch"},
	} {
		if got := activityDescription(c.ride); got != c.want {
			t.Errorf("%s: %q, want %q", c.what, got, c.want)
		}
	}
}
