/**
 * Where a dragged pane lands (#316) — pure geometry, no DOM.
 *
 * One sum: which guide line a dragged span clicks to, so the popped-out stage
 * can be tucked against an edge or the middle on purpose rather than landed
 * by eye.
 */
/** Guide lines, in viewport pixels. */
export interface Guides {
	x: number[];
	y: number[];
}

/**
 * Within this many pixels an edge clicks to a guide — and lets go the moment
 * you keep pulling. A hint, never a trap.
 */
export const SNAP = 8;

/** The nearest guide within reach, else the value untouched. */
export function snap(value: number, guides: number[]): number {
	let best = value;
	let gap = SNAP;
	for (const guide of guides) {
		const distance = Math.abs(value - guide);
		if (distance <= gap) {
			gap = distance;
			best = guide;
		}
	}
	return best;
}

/**
 * Slide a whole pane so that whichever of its leading, middle or trailing
 * edge is nearest a guide lands on it — that middle candidate is what makes
 * "centred" a place you can drop something.
 */
export function snapSpan(
	value: number,
	size: number,
	guides: number[],
): number {
	// An edge out of reach reports back the value it was given, so only the
	// candidates that actually moved are in the running — otherwise a
	// no-op always "wins" for being nearest.
	const caught = [
		snap(value, guides),
		snap(value + size / 2, guides) - size / 2,
		snap(value + size, guides) - size,
	].filter((candidate) => candidate !== value);
	return caught.length === 0
		? value
		: caught.reduce((best, candidate) =>
				Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best,
			);
}
