/**
 * Does a track's tempo fit the cadence the block asks for (#1431)? The same
 * rule smart autoplay weighs by (docs/SPEC.md "BPM matching"): within ±5 % of
 * the rpm, or of double it — the same beat, felt one pedal stroke at a time
 * instead of two. Untagged tracks and an idle deck never fit, and never
 * fail: there is nothing to say.
 */
export const CADENCE_TOLERANCE = 0.05;

export function fitsCadence(
	bpm: number | undefined,
	rpm: number | undefined,
): boolean {
	if (!bpm || !rpm || bpm <= 0 || rpm <= 0) return false;
	return (
		Math.abs(bpm - rpm) <= rpm * CADENCE_TOLERANCE ||
		Math.abs(bpm - rpm * 2) <= rpm * 2 * CADENCE_TOLERANCE
	);
}
