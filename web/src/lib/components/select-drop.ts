/**
 * Which way a `Select` opens (#945) — pure geometry, no DOM.
 *
 * A picker at the bottom of a tall dialog dropped its list past the fold, and
 * the last device on the list was then unreachable.
 */

/** A full list: the 16rem option area plus the filter row above it. */
export const PANEL = 288;

/** True when the list should open above the trigger instead of below it. */
export function dropsUp(
	trigger: { top: number; bottom: number },
	viewportHeight: number,
): boolean {
	// Below is the default: only a panel that does not fit there and does fit
	// above is worth flipping — otherwise flipping just moves the clipping.
	return viewportHeight - trigger.bottom < PANEL && trigger.top > PANEL;
}
