import { untrack } from 'svelte';
import { climbedStep } from '$lib/ride/climbed';
import type { Road } from '$lib/road/road';

/**
 * Metres climbed this ride (TARGETS ride-free-road 3): the rises between one
 * second's metre and the next, while the free ride records. Off a road
 * nothing climbs, so nothing says so (ux.md: a cue exists only where its
 * model exists). Call it where the ride lives: a ride that outlives its
 * screen counts in its own root, so a screen opened again carries on.
 */
export function countClimbed(free: {
	readonly recording: boolean;
	readonly road: { readonly profile: Road; readonly m: number } | null;
}) {
	let climbed = $state(0);
	let lastM: number | null = null;
	$effect(() => {
		const road = free.road;
		const at = road ? { profile: road.profile, m: road.m } : null;
		const recording = free.recording;
		untrack(() => {
			if (!recording || !at) {
				climbed = 0;
				lastM = null;
				return;
			}
			if (lastM !== null) climbed += climbedStep(at.profile, lastM, at.m);
			lastM = at.m;
		});
	});
	return {
		get m() {
			return climbed;
		},
	};
}
