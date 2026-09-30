import type { TrainerSample } from '$lib/ble/trainer';
import type { createActuator, SprintSetup } from '$lib/ride/actuation.svelte';
import { biasPress } from '$lib/ride/easier-harder';
import { nudgedBias, toleranceBand } from './guards';
import type { createHrHold } from './hr-hold.svelte';
import type { createRideClock } from './ride-clock.svelte';
import type { RideState } from './ride-state';
import type { createRiderGuards } from './rider-guards.svelte';

/**
 * What a solo ride asks of its trainer: the target, the rider's bias trim
 * on it, and the one chokepoint every write goes through — the solo twin of
 * the session ride's ride-target.svelte.ts.
 */
export function createSoloAim(deps: {
	actuator: ReturnType<typeof createActuator>;
	clock: () => ReturnType<typeof createRideClock>;
	guards: ReturnType<typeof createRiderGuards>;
	hrHold: ReturnType<typeof createHrHold>;
	state: () => RideState;
	sample: () => TrainerSample | null;
	sprint: () => SprintSetup;
	ftp: number;
}) {
	let bias = $state(1);

	/**
	 * Released during spiral guard and while auto-paused — both mean "no
	 * target" — and zero through the count-in, which has not asked for one
	 * yet (#1800).
	 */
	const target = $derived.by(() => {
		const state = deps.state();
		const info = deps.clock().info;
		return state === 'autopaused' ||
			state === 'countdown' ||
			deps.guards.spiralActive
			? 0
			: deps.hrHold.watts(info.segment, info.targetWatts ?? 0);
	});

	const inBand = $derived.by(() => {
		const sample = deps.sample();
		return (
			target > 0 &&
			sample !== null &&
			Math.abs(sample.watts - target) <= toleranceBand(target)
		);
	});

	function apply() {
		// Nothing reaches the trainer during the count-in (#1800). This is the
		// one chokepoint for every target write — start(), the ticker, a bias
		// nudge, skip/extend and repair() all come through here — so the first
		// block's target lands when the clock does and not three seconds early.
		if (deps.state() === 'countdown') return;
		// A sprint outranks the guards, for the reason a group session gives
		// (session/ride.svelte.ts): auto-pause is an INFERENCE that the rider
		// left, a sprint is an announced effort they are about to answer.
		if (deps.clock().sprinting) deps.actuator.sprint(deps.sprint(), deps.ftp);
		else deps.actuator.hold(target);
	}

	function nudgeBias(step: number) {
		bias = nudgedBias(bias, step);
		apply();
	}

	return {
		get bias() {
			return bias;
		},
		get target() {
			return target;
		},
		get inBand() {
			return inBand;
		},
		apply,
		nudgeBias,
		/** Easier / Harder (#3328): a gear in SIM, the bias in ERG. */
		easierHarder: (dir: 1 | -1) =>
			deps.actuator.easierHarder(
				dir,
				biasPress(() => bias, nudgeBias),
			),
	};
}
