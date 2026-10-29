import { untrack } from 'svelte';
import { climbedM } from '$lib/ride/climbed';
import type { Road } from '$lib/road/road';
import { JUMP_M } from '$lib/world/sim';

/**
 * Metres climbed this ride (TARGETS ride-free-road 3): the rises between one
 * second's metre and the next; a jump is a lap turned, not a climb. Off a
 * road nothing climbs, so nothing says so (ux.md: a cue exists only where
 * its model exists). Called during component init: the $effect needs it.
 */
export function createClimbCount(
	at: () => { profile: Road; m: number } | null,
	recording: () => boolean,
) {
	let climbed = $state(0);
	let lastM: number | null = null;
	$effect(() => {
		const here = at();
		const on = recording();
		untrack(() => {
			if (!on || !here) {
				climbed = 0;
				lastM = null;
				return;
			}
			if (lastM !== null && Math.abs(here.m - lastM) <= JUMP_M)
				climbed += climbedM(here.profile, lastM, here.m);
			lastM = here.m;
		});
	});
	return {
		get m() {
			return climbed;
		},
	};
}
