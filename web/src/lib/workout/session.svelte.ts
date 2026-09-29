import { arbitrate } from '$lib/ble/arbitrate';
import { publishHud } from '$lib/hud/feed';
import { DEFAULT_PROFILE } from '$lib/profile.svelte';
import type { SensorKind, SensorReading } from '$lib/ble/sensor';
import type { Trainer, TrainerSample } from '$lib/ble/trainer';
import { createActuator, type SprintSetup } from '$lib/ride/actuation';
import { createPersonalGuards, DEFAULTS, toleranceBand } from './guards';
import { createRideRecord, type RecordedSecond } from './ride-record.svelte';
import { createRideClock } from './ride-clock.svelte';
import { createRideHold } from './ride-hold.svelte';
import type { Workout } from './types';

import { COUNTDOWN_SECONDS, signalLost, type RideState } from './ride-state';

export interface RideOptions {
	trainer: Trainer;
	workout: Workout;
	ftp: number;
	/** Injected so tests can drive the clock; defaults to wall time. */
	now?: () => number;
	/**
	 * When the ride began, ms epoch — the crash-safety buffer's own stamp
	 * (#19), so the upload and a later retry from the recovery card name the
	 * same ride. Two stamps a few hundred ms apart used to save it twice
	 * (audit 2026-09-09). Defaults to now.
	 */
	startedAt?: number;
	/**
	 * Latest reading from each paired sensor (#11). Read per sample rather than
	 * subscribed to, because arbitration is a snapshot question — which source wins
	 * *right now* — and a sensor that has gone quiet has to lose on staleness.
	 */
	readings?: () => Partial<Record<SensorKind, SensorReading>>;
	/**
	 * The rider's sprint setup (#30/#41), read per sprint so a change on
	 * /settings lands mid-ride. A `sprint` step carries no ERG target by
	 * design — the trainer is released to slope for the window — and this path
	 * used to collapse that into ERG 0 W, which is a freewheel (#1529).
	 */
	sprint?: () => SprintSetup;
	/** Called with each recorded sample — the crash-safety buffer's seam (#19). */
	onRecord?: (sample: RecordedSecond) => void;
}

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
	let state = $state<RideState>('idle');
	/** Seconds left in the count-in; 0 whenever the ride is not counting in. */
	let countdownRemaining = $state(0);
	let bias = $state(1);
	let sample = $state<TrainerSample | null>(null);
	/**
	 * Auto-pause and the spiral release, shared with the group path so a rider
	 * gets the same protection in a session as alone (#788). The mirrors below
	 * are what makes the machine's answers reactive here.
	 */
	const guards = createPersonalGuards();
	let resumeIn = $state(0);
	let spiralActive = $state(false);
	const record = createRideRecord(ftp);
	// How long the rider has sat auto-paused, on the ride's own clock (#2622).
	let pausedSeconds = 0;
	// Flipped synchronously by start(), before it awaits the trainer: two taps
	// a frame apart both got past a state check that only moved once the
	// hardware answered (#1800).
	let starting = false;
	const hold = createRideHold(trainer, {
		onSample,
		tick,
		now,
		state: () => state,
	});

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
		state === 'autopaused' || state === 'countdown' || spiralActive
			? 0
			: (clock.info.targetWatts ?? 0),
	);

	const inBand = $derived(
		target > 0 &&
			sample !== null &&
			Math.abs(sample.watts - target) <= toleranceBand(target),
	);

	const actuator = createActuator(() => hold.trainer);

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

	/**
	 * The guards are a plain machine; these are its answers made reactive. The
	 * ride's own states — idle, done — are not the guards' to set.
	 */
	function syncGuards() {
		state = guards.phase;
		if (state !== 'autopaused') pausedSeconds = 0;
		resumeIn = guards.resumeIn;
		spiralActive = guards.spiralActive;
	}

	function onSample(raw: TrainerSample) {
		// A paired power meter outranks the trainer, and a dedicated cadence sensor
		// outranks both (RESEARCH.md §11). Resolved here so the whole ride — targets,
		// auto-pause, execution, the .fit — reads one agreed set of numbers.
		const metrics = arbitrate({ trainer: raw, sensors: readings() }, raw.at);
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
		publish();
		// Nothing is ridden during the count-in (#1800): the sample is kept, so
		// the numbers are live the instant the clock starts, but the record, the
		// score and the guards belong to a ride that has not begun.
		if (state === 'countdown') return;
		// The record and the score admit one sample per ride second; the
		// guards below look at every one — a stop is noticed by the sample
		// that stopped, not by the second's first.
		const admit = record.admits(raw.at);

		// Auto-pause and the spiral guard, against the PRESCRIBED target: the one
		// the trainer holds is zero exactly when a guard is already up. Before
		// the record below, so the second that trips a guard is stamped as
		// the guard's (#1796) — the same answer the live score gives it.
		const pedalling = guards.pedalling(next);
		if (state !== 'idle') {
			// The same per-second gate the record uses (#1798): the guards count
			// seconds, and a trainer notifies more than once a second.
			const actuate = guards.sample(
				next,
				clock.info.targetWatts ?? 0,
				admit ? 1 : 0,
			);
			syncGuards();
			if (actuate) applyTarget();
		}

		if (admit) {
			const recorded = record.add(
				raw.at,
				clock.seconds,
				next,
				bias,
				!guards.scoring,
			);
			onRecord?.(recorded);
		}

		// Execution excludes auto-paused time and untargeted blocks (docs/SPEC.md). The
		// grace seconds before auto-pause engages are excluded too — the rider had
		// already stopped, we simply had not noticed yet. A ramp is a warmup or a
		// cooldown, which SPEC excludes as well: the server has always agreed
		// (workout.TargetAt reports those seconds unscored) and this side had not.
		if (
			admit &&
			state === 'running' &&
			target > 0 &&
			pedalling &&
			clock.info.segment?.kind === 'steady'
		)
			record.score(next.watts, target, bias);
	}

	/**
	 * Advance the ride by `seconds`. Normally one, but a throttled or delayed tick
	 * reports the seconds it actually covers (#51) — the ride catches up in a jump
	 * rather than running slow for as long as the tab stays hidden.
	 */
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
			fault: signalLost({ state, sample }, ridingSince, now())
				? 'trainer'
				: undefined,
		});
	}

	// Stamped by tick() when the count-in ends, cleared on reset. Not $state:
	// nothing renders it, and only publish() reads it.
	let ridingSince: number | undefined;

	function tick(seconds = 1) {
		// The count-in runs on the ride's own clock (#1800), so the digit on
		// screen and the 3-2-1 cue cannot drift apart — and a throttled tab
		// catches up here the way the ride does. The workout clock, the score
		// and the first ERG write all wait for it.
		if (state === 'countdown') {
			countdownRemaining = Math.max(0, countdownRemaining - seconds);
			if (countdownRemaining > 0) return;
			state = 'running';
			// When the CLOCK started, for the dropout rule below (#2200): a
			// trainer that sends frames without a power field never produces a
			// first sample, so silence has to be counted from something that
			// is not one.
			ridingSince = now();
			applyTarget();
			clock.sync();
			return;
		}
		publish();
		if (state === 'resuming') {
			const actuate = guards.tick(seconds);
			syncGuards();
			if (actuate) applyTarget();
			return;
		}
		// Stopped long enough that the rider has gone (#2622): the ride ends
		// itself, and the stopped run is not part of it.
		if (state === 'autopaused') {
			pausedSeconds += seconds;
			if (pausedSeconds >= DEFAULTS.stoppedEndsAfterSeconds) {
				record.trimStoppedTail(guards.pedalling);
				finish();
			}
			return;
		}
		if (state !== 'running') return;

		if (spiralActive) {
			const actuate = guards.tick(seconds);
			syncGuards();
			if (actuate) applyTarget();
		}

		clock.advance(seconds);
		if (clock.seconds >= clock.total) {
			finish();
			return;
		}
		applyTarget();
		clock.sync();
	}

	/**
	 * The end of the ride, whichever door it came through: the clock running
	 * out or the rider's End button. It used to live in stop() alone (#1795),
	 * so the happy path — riding a workout to its end — left the GATT link
	 * open, the screen awake and the recorder running under the summary, and
	 * an Export pressed five minutes later was five minutes too long.
	 */
	function finish() {
		if (state === 'done') return;
		hold.drop();
		actuator.release();
		countdownRemaining = 0;
		void hold.trainer.setTargetPower(0);
		// Let go of the hardware (#1546): after the summary nothing owns
		// this link, and the next pairing screen showed an unpaired grid
		// over a connection that was still open — a session's unpair()
		// does the same.
		void hold.trainer.disconnect();
		state = 'done';
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
			return resumeIn;
		},
		get spiralActive() {
			return spiralActive;
		},
		/** The trainer this ride holds, for the recovery card (#1847). */
		get trainerName() {
			return hold.trainer.name;
		},
		get trainerStatus() {
			return hold.status;
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
			const old = hold.swap(next);
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
			return countdownRemaining;
		},

		async start() {
			// One Start per session (#1800): the count-in leaves the button on
			// screen for three seconds, and a second tap used to build a second
			// ride on the same trainer.
			if (starting || state !== 'idle') return;
			starting = true;
			try {
				const held = hold.trainer;
				if (held.status !== 'connected') await held.connect();
			} catch (cause) {
				starting = false;
				throw cause;
			}
			// The clock starts when the count-in ends, not when Start is pressed
			// (#1800, ADR-0046): tick() owns the move to 'running', and with it
			// the first target write.
			state = 'countdown';
			countdownRemaining = COUNTDOWN_SECONDS;
			hold.take();
		},
		/**
		 * The rider changed their mind during the count-in (#1800). Not stop():
		 * nothing has been ridden, so there is no ride to end, save or export —
		 * the session goes back to idle and hands the trainer back, still
		 * connected, for whoever paired it to hold again (#2615).
		 */
		abort(): Trainer | undefined {
			if (state !== 'countdown') return undefined;
			hold.drop();
			countdownRemaining = 0;
			state = 'idle';
			ridingSince = undefined;
			starting = false;
			return hold.trainer;
		},
		stop() {
			finish();
		},
		nudgeBias(step: number) {
			bias = Math.min(
				DEFAULTS.biasMax,
				Math.max(DEFAULTS.biasMin, Math.round((bias + step) * 100) / 100),
			);
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
