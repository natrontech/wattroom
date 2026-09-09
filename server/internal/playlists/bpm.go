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

// Auto-DJ (#271, ADR-0015 smart selection step 4): a track that resembles
// what this room has lately played THROUGH gets a lift. The whole of it is
// one more factor in the same scoring pass — no model, no embeddings, which
// is the ceiling ADR-0015 set for this box.
const (
	// How many of the room's recent completions define its current taste.
	// By count rather than by time: a crew's taste is the last things it
	// enjoyed, and a room that rode yesterday should not come back to a
	// blank slate. Twenty is an evening.
	affinityWindow = 20
	// Same artist as something recently finished. The strong signal — a
	// name means one thing and means it exactly.
	artistBoost = 3.0
	// A tag in common instead. Weaker on purpose: tags are free-form with no
	// taxonomy (ADR-0015), so "rock" on half the pool says much less than a
	// name does, and a broad one that boosted everything equally would be
	// the same as boosting nothing.
	tagBoost = 1.5
)

// targetCadence is hub.SessionMood.TargetRPM as the float the query takes
// (#1431 moved the rule into the hub, where the tick also reads it).
func targetCadence(mood hub.SessionMood) (rpm float64, ok bool) {
	if r := mood.TargetRPM(); r > 0 {
		return float64(r), true
	}
	return 0, false
}
