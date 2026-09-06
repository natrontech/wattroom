package hub

import (
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// Two riders on the same w/kg used to be placed by map iteration order, so
// the 5 and the 3 points of a points race went to either at random (#824).
func TestPodiumBreaksTiesTheSameWayEveryTime(t *testing.T) {
	seen := map[string]protocol.Rider{
		"b": {ID: "b", Name: "B", WeightKg: 80},
		"a": {ID: "a", Name: "A", WeightKg: 80},
		"c": {ID: "c", Name: "C", WeightKg: 80},
	}
	samples := map[string][]int{
		"a": {400, 400, 400, 400, 400},
		"b": {400, 400, 400, 400, 400},
		"c": {500, 500, 500, 500, 500},
	}
	for round := 0; round < 20; round++ {
		got := podium(samples, seen)
		if len(got) != 3 || got[0].RiderID != "c" || got[1].RiderID != "a" || got[2].RiderID != "b" {
			t.Fatalf("round %d: podium order %v", round, got)
		}
	}
}
