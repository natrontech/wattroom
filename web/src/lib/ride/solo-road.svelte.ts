import { arbitrate } from '$lib/ble/arbitrate';
import type { SensorKind, SensorReading } from '$lib/ble/sensor';
import type { Trainer, TrainerSample } from '$lib/ble/trainer';
import { publishHud } from '$lib/hud/feed';
import { createActuator } from '$lib/ride/actuation.svelte';
import { FREE_RIDE_NAME, type FreeRide } from '$lib/ride/free-ride.svelte';
import { createRideShift } from '$lib/ride/ride-shift';
import type { RideableRoute } from '$lib/ride/roads';
import { publishRide } from '$lib/workout/ride-life.svelte';
import { acquireWakeLock, type WakeLock } from '$lib/workout/wakelock';
import { createRiderGuards } from '$lib/workout/rider-guards.svelte';

/**
 * A free ride on a road, alone at /ride?road= (#3027) — the channel's free
 * ride lifted out for parity (ADR-0046). The same free ride model rides the
 * road; this holds the trainer the channel's connection would: one sample a
 * wall-clock second into the free ride, and its trainer driven by the road's
 * felt grade, or by ERG by the road behind the rider's guards in watts mode.
 * No count-in: a free ride has none (docs/SPEC.md).
 *
 * Called during component init, like createRide: the $effect needs it.
 */
export function createSoloRoadRide(deps: {
	free: FreeRide;
	route: RideableRoute;
	/** A resumed ride's metre (the recovered card's Resume at km). */
	from?: number;
	readings?: () => Partial<Record<SensorKind, SensorReading>>;
}) {
	let trainer = $state.raw<Trainer | null>(null);
	let wakeLock: WakeLock | undefined;
	let off: (() => void) | undefined;
	let lastSecond = -1;
	/** The ride's numbers this second, sensors ranked over the trainer. */
	let metrics = $state.raw<ReturnType<typeof arbitrate> | null>(null);
	const guards = createRiderGuards();
	const actuator = createActuator(() => trainer);

	// Watts mode holds the watts the road asks for — through the guards, so
	// a rider who stops is not held at them (docs/SPEC.md: the guards apply
	// in watts mode). Grade mode has no target to release.
	const target = $derived(
		deps.free.mode === 'watts' && !guards.released ? deps.free.targetWatts : 0,
	);

	$effect(() => {
		if (!trainer) return;
		const road = deps.free.road;
		if (deps.free.mode === 'grade' && road) actuator.road(road.felt);
		else actuator.hold(target);
	});

	// Riding from the first stroke to End ride, or until the page goes: the
	// frame caves, the HUD opens and DMs wait, as on a workout ride (#3667).
	$effect(() => (trainer ? publishRide(() => 'running') : undefined));

	$effect(() => {
		if (!trainer) return;
		const id = setInterval(() => {
			if (guards.tick(1)) actuator.hold(target);
		}, 1000);
		return () => clearInterval(id);
	});

	function onSample(raw: TrainerSample) {
		const ranked = arbitrate(
			{ trainer: raw, sensors: deps.readings?.() ?? {} },
			raw.at,
		);
		metrics = ranked;
		actuator.sample(raw);
		const second = Math.floor(raw.at / 1000);
		const opens = second > lastSecond;
		if (opens) lastSecond = second;
		if (deps.free.mode === 'watts')
			guards.sample(ranked, deps.free.targetWatts, opens ? 1 : 0);
		if (!opens) return;
		deps.free.second({
			watts: ranked.watts,
			cadence: ranked.cadence,
			hr: ranked.heartRate ?? 0,
			at: raw.at,
		});
		// The HUD feed (ADR-0041), as a free ride in a channel publishes it,
		// with where on the road (#3639).
		if (deps.free.recording)
			publishHud({
				watts: ranked.watts,
				target: deps.free.targetWatts,
				remaining: 0,
				elapsed: deps.free.seconds,
				label: FREE_RIDE_NAME,
				road: deps.free.road?.readout,
			});
	}

	// A gear on the road's grade; in watts mode the road sets the watts, so
	// Easier and Harder have nothing to move there — as in a channel.
	const shift = createRideShift({
		easierHarder: (dir) => actuator.easierHarder(dir),
		atEnd: (dir) => actuator.atEnd(dir),
	});

	return {
		get trainer() {
			return trainer;
		},
		get gear() {
			return actuator.gear;
		},
		get metrics() {
			return metrics;
		},
		get guard() {
			return guards.phase;
		},
		shift,
		/**
		 * On the road with this trainer, recording from the first stroke —
		 * from `from`, or where the page opened it.
		 */
		start(next: Trainer, from = deps.from ?? 0) {
			if (trainer) return;
			deps.free.arm();
			deps.free.ride(deps.route, from);
			trainer = next;
			off = next.onSample(onSample);
			wakeLock = acquireWakeLock();
		},
		/** End ride: saved, or let go under the minute, and the trainer released. */
		async end() {
			const held = trainer;
			off?.();
			off = undefined;
			actuator.release();
			trainer = null;
			shift.stop();
			wakeLock?.release();
			wakeLock = undefined;
			void held?.disconnect();
			return deps.free.end();
		},
	};
}

export type SoloRoadRide = ReturnType<typeof createSoloRoadRide>;
