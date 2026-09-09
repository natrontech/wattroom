package hub

import (
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// Best 5 s w/kg needs five seconds: two samples used to be ranked on a
// two-second average, which beats every honest five (audit 2026-09-09).
func TestPodiumNeedsFiveSeconds(t *testing.T) {
	seen := map[string]protocol.Rider{
		"whole": {ID: "whole", Name: "Whole", WeightKg: 80},
		"blip":  {ID: "blip", Name: "Blip", WeightKg: 80},
	}
	got := podium(map[string][]int{
		"whole": {600, 600, 600, 600, 600, 600, 600},
		"blip":  {900, 900},
	}, seen)
	if len(got) != 1 || got[0].RiderID != "whole" {
		t.Fatalf("podium %v, want only the rider who sprinted five seconds", got)
	}
}
