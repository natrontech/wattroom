import { arbitrate } from '$lib/ble/arbitrate';
import { DEFAULT_PROFILE } from '$lib/profile.svelte';
import type { TrainerSample } from '$lib/ble/trainer';
import { createActuator } from '$lib/ride/actuation.svelte';
import { createRiderGuards } from './rider-guards.svelte';
import { wireSoloGuards } from './solo-guards';
import { createHrHold } from './hr-hold.svelte';
import { countsToward, createRideRecord } from './ride-record.svelte';
import { createLiveStats } from '$lib/ride/live-stats.svelte';
import { createRideClock } from './ride-clock.svelte';
import { createRideLife } from './ride-life.svelte';
import { createRoadDot } from './road-dot.svelte';
import { createRideHud } from './ride-hud';
import { createSoloAim } from './solo-aim.svelte';
import type { RideOptions, RideState } from './ride-state';

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
		swapped: () => {
			actuator.release();
			applyTarget();
		},
	});
	/** The ride's life, and while it rides, the guards' word on how (#3369). */
	const state = $derived<RideState>(
		life.life === 'riding' ? guards.phase : life.life,
	);

	// A road workout's blocks end at their metres (#3499): the dot's
	// position is the clock.
	const dot = createRoadDot(workout, kg);
	const clock = createRideClock(workout, ftp, {
		bias: () => aim.bias,
		over: () => state === 'done',
		road: dot.position,
	});

	const actuator = createActuator(() => life.trainer);
	const aim = createSoloAim({
		actuator,
		clock: () => clock,
		guards,
		hrHold,
		state: () => state,
		sample: () => sample,
		sprint,
		ftp,
	});
	const applyTarget = aim.apply;
	const guarding = wireSoloGuards(guards, {
		state: () => state,
		prescribed: () => clock.info.targetWatts ?? 0,
		actuate: applyTarget,
		record,
		end: finish,
	});

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
			aim.bias,
			!guards.scoring,
		);
		onRecord?.(recorded);
		const target = aim.target;
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
		if (scored) record.score(next.watts, target, aim.bias);
	}

	const publish = createRideHud({
		label: workout.name,
		state: () => state,
		sample: () => sample,
		target: () => aim.target,
		remaining: () => clock.total - clock.seconds,
		ridingSince: () => life.ridingSince,
		now,
	});

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
		/** The ride's live numbers so far (#3068). */
		get live() {
			return live.current;
		},
		/** The ride as recorded, for .fit export. */
		get recording() {
			return record.recording;
		},
		get startedAt() {
			return startedAt;
		},
		get target() {
			return aim.target;
		},
		get bias() {
			return aim.bias;
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
			return aim.inBand;
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
		/** Ride on with another trainer (#1847): see the life's repair. */
		repair: life.repair,
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
		nudgeBias: aim.nudgeBias,
		atEnd: actuator.atEnd,
		easierHarder: aim.easierHarder,
		/** Jump to the start of the next block. */
		skip() {
			if (!clock.skip()) return;
			applyTarget();
			clock.sync();
		},
		/** Hold the current block longer (see the clock's extend). */
		extend(seconds: number) {
			if (!clock.extend(seconds)) return;
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
