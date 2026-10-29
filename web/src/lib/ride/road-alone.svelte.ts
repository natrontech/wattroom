import type { Trainer } from '$lib/ble/trainer';
import { createProfileStore } from '$lib/profile.svelte';
import type { createRideFlags } from '$lib/ride/flags.svelte';
import { createFreeRide, freeRideLabel } from '$lib/ride/free-ride.svelte';
import { createGhostSplit } from '$lib/ride/ghost-split.svelte';
import { rememberRoad } from '$lib/ride/last-ride';
import type { RideableRoute } from '$lib/ride/roads';
import { createSoloRoadRide } from '$lib/ride/solo-road.svelte';
import { sensors } from '$lib/sensors.svelte';
import { SIGNAL_LOST_MS } from '$lib/workout/ride-state';

/**
 * A free ride alone on a road (#3027), held as the device's one ride
 * (ADR-0093): its effects live in a root of their own, so it rides on while
 * the rider reads the crew, and only End ride ends it. `dispose` lets it go
 * once its closing card is done with.
 */
export function holdRoadAlone(deps: {
	route: RideableRoute;
	from: number;
	trainer: Trainer;
	flags: ReturnType<typeof createRideFlags>;
}) {
	const { route, flags } = deps;
	const profile = createProfileStore();
	let free!: ReturnType<typeof createFreeRide>;
	let solo!: ReturnType<typeof createSoloRoadRide>;
	let ghost!: ReturnType<typeof createGhostSplit>;
	let watts = $state(0);
	// The instrument says when its numbers are not live (#2851): a trainer
	// silent past the rides' one number, SIGNAL_LOST_MS.
	let lastAt = $state(0);
	let now = $state(Date.now());
	let ended = $state(false);

	const dispose = $effect.root(() => {
		free = createFreeRide({
			ftp: () => profile.current.ftp,
			singleSpeed: () => profile.current.singleSpeed,
			kg: () => profile.current.kg,
		});
		solo = createSoloRoadRide({
			free,
			route,
			from: deps.from,
			readings: () => sensors.readings,
		});
		ghost = createGhostSplit(() => free);
		$effect(() => {
			const trainer = solo.trainer;
			if (!trainer) return;
			lastAt = Date.now();
			const tick = setInterval(() => (now = Date.now()), 1000);
			const off = trainer.onSample((s) => {
				watts = s.watts;
				lastAt = Date.now();
				flags.recorder.tick({
					watts: s.watts,
					cadence: s.cadence,
					target: free.targetWatts,
					state: free.recording ? 'riding' : 'armed',
				});
			});
			return () => {
				clearInterval(tick);
				off();
			};
		});
	});

	solo.start(deps.trainer, deps.from);
	flags.riding(deps.trainer.name, freeRideLabel(route));
	// The card's “your last road” (#3671); a crew's road is not yours.
	if (!route.borrowed) rememberRoad(route.id);

	return {
		route,
		free,
		solo,
		ghost,
		get watts() {
			return watts;
		},
		get stale() {
			return !!solo.trainer && now - lastAt > SIGNAL_LOST_MS;
		},
		/** End ride was pressed: the closing card, or the line under a minute. */
		get ended() {
			return ended;
		},
		async end() {
			ended = true;
			await solo.end();
		},
		dispose,
	};
}

export type RoadAlone = ReturnType<typeof holdRoadAlone>;
