import { play } from '$lib/sound/cues';
import type { ClimbView } from '$lib/ride/climb-view';

/**
 * The climb card's cues (#3645, ux.md: state changes announce themselves):
 * `climb` once as a classed climb's card opens, `summit` once at its top.
 * Called once by the surface that rides the road, never by a display — a
 * TV beside the desk would say it twice.
 */
export function watchClimbCues(view: () => ClimbView | null | undefined) {
	let opened: number | null = null;
	let topped: number | null = null;
	$effect(() => {
		const v = view();
		const climb = v?.climb.startM ?? null;
		if (climb === null) return;
		if (climb !== opened) {
			opened = climb;
			play('climb');
		}
		if (v?.card.summited && climb !== topped) {
			topped = climb;
			play('summit');
		}
	});
}
