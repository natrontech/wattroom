/**
 * How many modal surfaces are open. The jukebox dock reads it: while a modal
 * is up the stage under it is covered, so the dock leaves its seat for the
 * corner, and the modal keeps a gutter above the dock — RMF wants the player
 * visible and unobstructed, and a modal wants the same for itself.
 */
import { untrack } from 'svelte';

export const modals = $state({ open: 0 });

/** Attach to a modal's root: counts it open for as long as it is mounted. */
export function countModal(): () => void {
	// untrack: an attachment re-runs when a dependency changes, and `+= 1`
	// READS the count it writes — so each mount re-ran itself forever
	// (effect_update_depth_exceeded). Counting is a side effect, not a
	// dependency.
	untrack(() => (modals.open += 1));
	return () => {
		untrack(() => (modals.open = Math.max(0, modals.open - 1)));
	};
}
