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
	got := podium(map[string][]sprintSample{
		"whole": consecutive(600, 600, 600, 600, 600, 600, 600),
		"blip":  consecutive(900, 900),
	}, seen)
	if len(got) != 1 || got[0].RiderID != "whole" {
		t.Fatalf("podium %v, want only the rider who sprinted five seconds", got)
	}
}

// Five samples either side of a gap are not five seconds (#2231): a WS drop,
// a trainer dropout or a throttled tab used to let the window span the gap
// and stitch two separate efforts into one best.
func TestPodiumWillNotSpanAGapInTheSamples(t *testing.T) {
	seen := map[string]protocol.Rider{
		"gapped": {ID: "gapped", Name: "Gapped", WeightKg: 80},
		"whole":  {ID: "whole", Name: "Whole", WeightKg: 80},
	}
	// Four 900 W seconds, eight seconds of silence, then three more: no five
	// consecutive seconds anywhere, so nothing to rank.
	gapped := []sprintSample{
		{second: 0, watts: 900}, {second: 1, watts: 900},
		{second: 2, watts: 900}, {second: 3, watts: 900},
		{second: 12, watts: 900}, {second: 13, watts: 900},
		{second: 14, watts: 900},
	}
	got := podium(map[string][]sprintSample{
		"gapped": gapped,
		"whole":  consecutive(400, 400, 400, 400, 400),
	}, seen)
	if len(got) != 1 || got[0].RiderID != "whole" {
		t.Fatalf("podium %v, want only the rider whose five seconds were five seconds", got)
	}
}
