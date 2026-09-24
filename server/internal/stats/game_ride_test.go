package stats

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// A game session's ride saves (#2597): its workout is the one hub's
// gameWorkoutJSON writes — the mode's name, no steps, unscored — and a JSON
// the parser refused would lose every rider's ride at the close.
func TestBuildRideRowTakesAGameSession(t *testing.T) {
	samples := make([]protocol.RiderMetrics, 600)
	for i := range samples {
		samples[i] = protocol.RiderMetrics{Watts: 220, Cadence: 90}
	}
	row, err := BuildRideRow(pgtype.UUID{}, "Floor is Lava",
		`{"name":"Floor is Lava","unscored":true,"steps":[]}`, time.Now(), 250, samples)
	if err != nil {
		t.Fatalf("a game's ride did not build: %v", err)
	}
	if row.ExecutionScored {
		t.Fatal("a game prescribes no target, so nothing is scored")
	}
	if row.Kj == 0 {
		t.Fatal("the work done was not counted")
	}
}
