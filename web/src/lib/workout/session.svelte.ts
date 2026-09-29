import { arbitrate } from '$lib/ble/arbitrate';
import { publishHud } from '$lib/hud/feed';
import { DEFAULT_PROFILE } from '$lib/profile.svelte';
import type { Trainer, TrainerSample } from '$lib/ble/trainer';
import { createActuator } from '$lib/ride/actuation';
import { nudgedBias, toleranceBand } from './guards';
import { createRiderGuards } from './rider-guards.svelte';
import { wireSoloGuards } from './solo-guards';
import { createHrHold } from './hr-hold.svelte';
import { countsToward, createRideRecord } from './ride-record.svelte';
import { createRideClock } from './ride-clock.svelte';
import { createRideLife } from './ride-life.svelte';
import { signalLost, type RideOptions, type RideState } from './ride-state';

/**
 * Owns one ride: advances the workout clock, holds the trainer on target, and
 * implements the rider controls from #13. Deliberately not a Svelte component —
 * the screen renders this, it does not own it.
 */
export function createRideSession({
	trainer,
	workout,
	ftp,
	now = Date.now,
	startedAt: startedAtMs,
	readings = () => ({}),
	sprint = () => ({
		grade: DEFAULT_PROFILE.sprintGrade,
		singleSpeed: DEFAULT_PROFILE.singleSpeed,
	}),
	onRecord,
}: RideOptions) {
	const startedAt = new Date(startedAtMs ?? now());
	let bias = $state(1);
	let sample = $state<TrainerSample | null>(null);
	/**
	 * Auto-pause and the spiral release, shared with the group path so a rider
	 * gets the same protection in a session as alone (#788).
	 */
	const guards = createRiderGuards();
	const record = createRideRecord(ftp);
	// A step that holds heart rate moves its own watts (#67).
	const hrHold = createHrHold(ftp);
	const life = createRideLife(trainer, {
		onSample,
		tick,
		now,
		state: () => state,
		back: () => actuator.reissue(),
	});
	/** The ride's life, and while it rides, the guards' word on how (#3369). */
	const state = $derived<RideState>(
		life.life === 'riding' ? guards.phase : life.life,
	);

	const clock = createRideClock(workout, ftp, {
		bias: () => bias,
		over: () => state === 'done',
	});

	/**
	 * Released during spiral guard and while auto-paused — both mean "no
	 * target" — and zero through the count-in, which has not asked for one
	 * yet (#1800).
	 */
	const target = $derived(
		state === 'autopaused' || state === 'countdown' || guards.spiralActive
			? 0
			: hrHold.watts(clock.info.segment, clock.info.targetWatts ?? 0),
	);

	const inBand = $derived(
		target > 0 &&
			sample !== null &&
			Math.abs(sample.watts - target) <= toleranceBand(target),
	);

	const actuator = createActuator(() => life.trainer);
	const guarding = wireSoloGuards(guards, {
		state: () => state,
		prescribed: () => clock.info.targetWatts ?? 0,
		actuate: applyTarget,
		record,
		end: finish,
	});

	function applyTarget() {
		// Nothing reaches the trainer during the count-in (#1800). This is the
		// one chokepoint for every target write — start(), the ticker, a bias
		// nudge, skip/extend and repair() all come through here — so the first
		// block's target lands when the clock does and not three seconds early.
		if (state === 'countdown') return;
		// A sprint outranks the guards, for the reason a group session gives
		// (session/ride.svelte.ts): auto-pause is an INFERENCE that the rider
		// left, a sprint is an announced effort they are about to answer.
		if (clock.sprinting) actuator.sprint(sprint(), ftp);
		else actuator.hold(target);
	}

	function onSample(raw: TrainerSample) {
		// A paired power meter outranks the trainer, and a dedicated cadence sensor
		// outranks both (RESEARCH.md §11). Resolved here so the whole ride — targets,
		// auto-pause, execution, the .fit — reads one agreed set of numbers.
		const metrics = arbitrate({ trainer: raw, sensors: readings() }, raw.at);
		actuator.sample(raw);
		// After the end nothing is recorded (#1795): the trainer is let go,
		// but a sample already in flight — or a test's — must not stretch the
		// export past the ride the account was handed.
		if (state === 'done') return;
		const next: TrainerSample = {
			watts: metrics.watts,
			cadence: metrics.cadence,
			heartRate: metrics.heartRate,
			at: raw.at,
		};
		sample = next;
		hrHold.reading(next.heartRate, raw.at);
		publish();
		// Nothing is ridden during the count-in (#1800): the sample is kept, so
		// the numbers are live the instant the clock starts, but the record, the
		// score and the guards belong to a ride that has not begun.
		if (state === 'countdown') return;
		// The record and the score admit one sample per ride second; the
		// guards look at every one — a stop is noticed by the sample that
		// stopped, not by the second's first.
		const admit = record.admits(raw.at);
		const pedalling = guarding.sample(next, admit);
		if (!admit) return;
		const recorded = record.add(
			raw.at,
			clock.seconds,
			next,
			bias,
			!guards.scoring,
		);
		onRecord?.(recorded);
		if (countsToward({ state, target, pedalling, segment: clock.info.segment }))
			record.score(next.watts, target, bias);
	}

	// The HUD feed (ADR-0041, #1665): the session publishes, not the screen,
	// so the floating window follows the ride off /ride — and carries the
	// fault the screen would be shouting about.
	function publish() {
		if (state === 'idle' || state === 'countdown' || state === 'done') return;
		publishHud({
			watts: sample?.watts ?? 0,
			target,
			remaining: Math.max(0, clock.total - clock.seconds),
			label: workout.name,
			// The rule both riding pages draw their banner from (#2158) — the
			// HUD used to need a first sample, so the rider who alt-tabbed
			// away from a trainer that never sends watts had the one surface
			// they were looking at saying nothing at all (#2200).
			fault: signalLost({ state, sample }, life.ridingSince, now())
				? 'trainer'
				: undefined,
		});
	}

	/**
	 * Advance the ride by `seconds`. Normally one, but a throttled or delayed tick
	 * reports the seconds it actually covers (#51) — the ride catches up in a jump
	 * rather than running slow for as long as the tab stays hidden.
	 */
	function tick(seconds = 1) {
		// The count-in runs on the ride's own clock (#1800), so the digit on
		// screen and the 3-2-1 cue cannot drift apart — and a throttled tab
		// catches up here the way the ride does. The workout clock, the score
		// and the first ERG write all wait for it.
		if (state === 'countdown') {
			if (life.countIn(seconds)) {
				applyTarget();
				clock.sync();
			}
			return;
		}
		publish();
		if (guarding.tick(seconds)) return;
		clock.advance(seconds);
		if (clock.seconds >= clock.total) {
			finish();
			return;
		}
		hrHold.tick(clock.info.segment, now());
		applyTarget();
		clock.sync();
	}

	/**
	 * The end of the ride, whichever door it came through: the clock running
	 * out, a rider gone (#2622) or End. It used to live in stop() alone
	 * (#1795), so riding a workout to its end left the link open, the screen
	 * awake and the recorder running under the summary.
	 */
	function finish() {
		if (!life.end()) return;
		actuator.release();
		clock.sync();
	}

	return {
		segments: clock.segments,
		total: clock.total,
		get elapsed() {
			return clock.seconds;
		},
		get state() {
			return state;
		},
		get sample() {
			return sample;
		},
		get trace() {
			return record.trace;
		},
		/** The ride as recorded, for .fit export. */
		get recording() {
			return record.recording;
		},
		get startedAt() {
			return startedAt;
		},
		get target() {
			return target;
		},
		get bias() {
			return bias;
		},
		get info() {
			return clock.info;
		},
		get execution() {
			return record.execution;
		},
		/** False when the workout prescribed nothing to score (#1454, #1544). */
		get scored() {
			return record.scored;
		},
		get inBand() {
			return inBand;
		},
		get resumeIn() {
			return guards.resumeIn;
		},
		get spiralActive() {
			return guards.spiralActive;
		},
		/** A heart-rate hold with no fresh heart rate: holding its watts (#67). */
		get hrHoldLost() {
			return hrHold.lost;
		},
		/** The trainer this ride holds, for the recovery card (#1847). */
		get trainerName() {
			return life.trainer.name;
		},
		get trainerStatus() {
			return life.status;
		},
		/**
		 * Ride on with another trainer (#1847): the recovery card used to pair
		 * into the slot that let go at Start, so the ride stayed subscribed
		 * to the first instance and the rider got two links and no watts.
		 * The old instance is let go — its own reattach loop would otherwise
		 * keep a second client on the same hardware.
		 */
		repair(next: Trainer) {
			if (state === 'done') return;
			const old = life.swap(next);
			actuator.release();
			applyTarget();
			void old.disconnect();
		},
		/** The sprint block on screen, or the one about to be — null otherwise. */
		get sprint() {
			return clock.window;
		},
		/** Seconds left in the count-in — 0 unless `state` is `countdown`. */
		get countdownRemaining() {
			return life.countdownRemaining;
		},
		start: life.start,
		abort: life.abort,
		stop: finish,
		nudgeBias(step: number) {
			bias = nudgedBias(bias, step);
			applyTarget();
		},
		/** Jump to the start of the next block. */
		skip() {
			if (!clock.skip()) return;
			applyTarget();
			clock.sync();
		},
		/** Hold the current block longer (see the clock's extend). */
		extend(seconds: number) {
			clock.extend(seconds);
			applyTarget();
			clock.sync();
		},
		/** Exposed for the ride screen's clock display and tests. */
		tick,
		onSample,
	};
}
