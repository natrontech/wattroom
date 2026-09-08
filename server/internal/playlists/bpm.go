package playlists

import "github.com/natrontech/wattroom/server/internal/hub"

// Matching music to the work (#270, ADR-0015 smart selection step 3:
// "prefer tracks whose BPM fits the target cadence/effort (~cadence or 2×
// cadence)"). Every number here is docs/SPEC.md's, and every one of them is
// a default to tune in alpha.
//
// The lever is cadence, not tempo directly: a track matches when its BPM sits
// near the rpm the room is turning, or near double it — which is the same
// beat, felt one pedal stroke at a time instead of two.
const (
	// How far from the target a track's BPM may sit and still count as a
	// match, as a fraction. ±5 % of 180 is ±9 BPM: wide enough that a pool
	// of real music has candidates, tight enough that adjacent effort tiers
	// do not blur into one another.
	bpmTolerance = 0.05
	// What a matching track's weight is multiplied by. A boost rather than a
	// penalty on everything else, so a pool with no BPM tagged at all draws
	// exactly as it did before this existed.
	bpmBoost = 3.0
)

// targetCadence is the rpm the room is turning during this block, and whether
// anything is worth matching to.
//
// A block that names a cadence band IS the answer — that band is the work
// (#66, "ERG holds the watts, the rpm is the workout"), so the midpoint wins
// over any guess from effort. Only 2 of the 28 library workouts carry one,
// which is why the effort fallback exists at all rather than the feature
// sitting idle on 26 of them.
//
// The effort tiers below are the one genuinely invented thing in this file:
// riders self-select a higher cadence as intensity rises, and these are that
// curve at four points. They are in docs/SPEC.md, marked as defaults.
func targetCadence(mood hub.SessionMood) (rpm float64, ok bool) {
	switch {
	case mood.CadenceLow > 0 && mood.CadenceHigh > 0:
		return float64(mood.CadenceLow+mood.CadenceHigh) / 2, true
	case mood.CadenceLow > 0:
		return float64(mood.CadenceLow), true
	case mood.CadenceHigh > 0:
		return float64(mood.CadenceHigh), true
	case mood.TargetPct <= 0:
		// Nothing running, or a block with no fraction that describes the
		// room (absolute watts, a sprint). No preference.
		return 0, false
	case mood.TargetPct <= 0.55:
		return 80, true // recovery
	case mood.TargetPct <= 0.75:
		return 85, true // endurance and tempo
	case mood.TargetPct <= 0.90:
		return 90, true // sweet spot and threshold
	default:
		return 95, true // VO₂ and above
	}
}
