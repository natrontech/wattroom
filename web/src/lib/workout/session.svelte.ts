import { arbitrate } from '$lib/ble/arbitrate';
import { publishHud } from '$lib/hud/feed';
import { DEFAULT_PROFILE } from '$lib/profile.svelte';
import type { Trainer, TrainerSample } from '$lib/ble/trainer';
import { createActuator } from '$lib/ride/actuation.svelte';
import { biasPress } from '$lib/ride/easier-harder';
import { nudgedBias, toleranceBand } from './guards';
import { createRiderGuards } from './rider-guards.svelte';
import { wireSoloGuards } from './solo-guards';
import { createHrHold } from './hr-hold.svelte';
import { countsToward, createRideRecord } from './ride-record.svelte';
import { createLiveStats } from '$lib/ride/live-stats.svelte';
import { createRideClock } from './ride-clock.svelte';
import { createRideLife } from './ride-life.svelte';
import { createRoadDot } from './road-dot.svelte';
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
	kg = () => 0,
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
	// The bike computer's numbers (#3068, #3088), one second per recorded one.
	const live = createLiveStats(() => ftp);
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

	// A road workout's blocks end at their metres (#3499): the dot's
	// position is the clock.
	const dot = createRoadDot(workout, kg);
	const clock = createRideClock(workout, ftp, {
		bias: () => bias,
		over: () => state === 'done',
		road: dot.position,
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
		// Stamped with when the heart rate was measured, not when this sample
		// arrived: a silent strap must age into lost, not stay fresh (#3517).
		hrHold.reading(metrics.heartRate, metrics.heartRateAt ?? raw.at);
		publish();
		// Nothing is ridden during the count-in (#1800): the sample is kept, so
		// the numbers are live the instant the clock starts, but the record, the
		// score and the guards belong to a ride that has not begun.
		if (state === 'countdown') return;
		// The record and the score admit one sample per ride second; the
		// guards look at every one — a stop is noticed by the sample that
		// stopped, not by the second's first.
		const admit = record.admits(raw.at);
		// On a road a coasted descent is riding (#3056).
		const pedalling = guarding.sample(
			{ ...next, virtualMps: dot.here?.virtualMps },
			admit,
		);
		if (!admit) return;
		const road = dot.second(next.watts, raw.at);
		const recorded = record.add(
			raw.at,
			clock.seconds,
			road
				? { ...next, virtualMps: road.virtualMps, m: dot.m, alt: road.alt }
				: next,
			bias,
			!guards.scoring,
		);
		onRecord?.(recorded);
		const scored = countsToward({
			state,
			target,
			pedalling,
			segment: clock.info.segment,
		});
		live.push({
			watts: next.watts,
			block: clock.info.segmentIndex,
			target: scored ? target : undefined,
		});
		if (scored) record.score(next.watts, target, bias);
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

	function nudgeBias(step: number) {
		bias = nudgedBias(bias, step);
		applyTarget();
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
		/** The ride's live numbers so far (#3068). */
		get live() {
			return live.current;
		},
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
		nudgeBias,
		atEnd: actuator.atEnd,
		/** Easier / Harder (#3328): a gear in SIM, the bias in ERG. */
		easierHarder: (dir: 1 | -1) =>
			actuator.easierHarder(
				dir,
				biasPress(() => bias, nudgeBias),
			),
		/** Jump to the start of the next block. */
		skip() {
			// On a road the road decides where a block ends (#3499).
			if (dot.pinned || !clock.skip()) return;
			applyTarget();
			clock.sync();
		},
		/** Hold the current block longer (see the clock's extend). */
		extend(seconds: number) {
			if (dot.pinned) return;
			clock.extend(seconds);
			applyTarget();
			clock.sync();
		},
		/**
		 * A road workout's place on its road (#3499): where the dot is and
		 * where the ride ends, in metres along the owner's road. Null off one.
		 */
		get road() {
			return dot.summary;
		},
		/** Exposed for the ride screen's clock display and tests. */
		tick,
		onSample,
	};
}
