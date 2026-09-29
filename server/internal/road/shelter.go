package road

import "github.com/natrontech/wattroom/server/internal/protocol"

// Shelter is the share of a rider's air drag the wheels ahead take (#3233,
// docs/SPEC.md "Drafting"): by where they are in the line — lineIndex 0 is
// the front, with nothing ahead, 1 the second wheel, 2 the third — how far
// behind the wheel ahead they ride, in metres, and how many lanes over. A
// wheel within ShelterFullGapM gives it whole, fading to none at
// ShelterNoneGapM; the adjacent lane gets half, and two lanes over nothing.
// Never more than ShelterMax. The hub computes it (ADR-0077); Pace.Step takes
// it as its shelter.
func Shelter(gapM float64, laneDelta, lineIndex int) float64 {
	if lineIndex < 1 || gapM >= protocol.ShelterNoneGapM {
		return 0
	}
	share := protocol.ShelterMax
	switch lineIndex {
	case 1:
		share = protocol.ShelterSecondWheel
	case 2:
		share = protocol.ShelterThirdWheel
	}
	if gapM > protocol.ShelterFullGapM {
		share *= (protocol.ShelterNoneGapM - gapM) / (protocol.ShelterNoneGapM - protocol.ShelterFullGapM)
	}
	switch max(laneDelta, -laneDelta) {
	case 0:
	case 1:
		share *= protocol.ShelterAdjacent
	default:
		return 0
	}
	return min(share, protocol.ShelterMax)
}
