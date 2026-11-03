import type { TrainerSample } from '$lib/ble/trainer';
import type { createActuator, SprintSetup } from '$lib/ride/actuation.svelte';
import { biasPress } from '$lib/ride/easier-harder';
import type { FreeMode } from '$lib/ride/free-ride-controls';
import { ergByRoad } from '$lib/ride/ride-grade';
import { nudgedBias, toleranceBand } from './guards';
import type { createHrHold } from './hr-hold.svelte';
import type { createRideClock } from './ride-clock.svelte';
import type { createRoadDot } from './road-dot.svelte';
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
	road: ReturnType<typeof createRoadDot>;
	/** No workout, the road on (#4257): the free ride's switch rides it. */
	open: () => boolean;
}) {
	let bias = $state(1);
	// Road or Watts with no workout on the road (#4283), as a free ride
	// opens: Road, but Watts on one gear, where a slope has no range (#3203).
	let drive = $state<FreeMode>(deps.sprint().singleSpeed ? 'watts' : 'grade');
	/**
	 * ERG by the road (docs/SPEC.md): the watts the road asks, before the
	 * guards, as the free ride's watts mode on a road holds them, with no
	 * trim. Null in Road, or with a workout on.
	 */
	const roadWatts = $derived(
		deps.open() && drive === 'watts'
			? ergByRoad(deps.ftp, deps.road.here?.roadPct ?? 0)
			: null,
	);

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
			: (roadWatts ?? deps.hrHold.watts(info.segment, info.targetWatts ?? 0));
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
		const segment = deps.clock().info.segment;
		if (deps.state() === 'running' && segment) deps.road.enter(segment);
		if (deps.clock().sprinting) deps.actuator.sprint(deps.sprint(), deps.ftp);
		else if (
			deps.state() === 'running' &&
			!deps.guards.released &&
			segment?.kind === 'road' &&
			roadWatts === null
		)
			deps.actuator.road(deps.road.here?.felt ?? 0);
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
		/** Road or Watts, while no workout is on the road. */
		get drive() {
			return drive;
		},
		/** What the guards hold the rider to: the block's watts, or the road's. */
		get prescribed() {
			return roadWatts ?? deps.clock().info.targetWatts ?? 0;
		},
		get roadWatts() {
			return roadWatts;
		},
		setDrive(next: FreeMode) {
			drive = next;
			apply();
		},
		get inBand() {
			return inBand;
		},
		apply,
		nudgeBias,
		/** Easier / Harder (#3328): a gear in SIM, the bias in ERG. */
		// In Watts the road sets the watts, as on a free ride's road: nothing to move.
		easierHarder: (dir: 1 | -1) =>
			deps.actuator.easierHarder(
				dir,
				roadWatts === null ? biasPress(() => bias, nudgeBias) : undefined,
			),
	};
}
