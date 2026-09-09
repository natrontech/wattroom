import { arbitrate } from '$lib/ble/arbitrate';
import { publishHud } from '$lib/hud/feed';
import { DEFAULT_PROFILE } from '$lib/profile.svelte';
import type { SensorKind, SensorReading } from '$lib/ble/sensor';
import type { Trainer, TrainerSample } from '$lib/ble/trainer';
import { flatten, targetAt } from './engine';
import { createPersonalGuards, DEFAULTS } from './guards';
import { createTicker, type Ticker } from './ticker';
import { acquireWakeLock, type WakeLock } from './wakelock';
import type { Segment, Workout } from './types';

/**
 * Every number here is docs/SPEC.md's ("Ride guards") — ridden and promoted in #46.
 * Tune them there, not here. They live with the guard machine that reads them
 * (workout/guards), and are re-exported because half the app imports them from
 * this module.
 */
export { DEFAULTS } from './guards';

/** docs/SPEC.md: within ±5 % of target, floor ±10 W. */
export function toleranceBand(target: number): number {
	return Math.max(target * 0.05, 10);
}

export type RideState = 'idle' | 'running' | 'autopaused' | 'resuming' | 'done';

/** Past this without a sample the dashboard, and the HUD, say so (#37). */
export const SIGNAL_LOST_MS = 3000;

/**
 * The frame caves while a solo session is live (ADR-0020: the ride is the
 * cave, sidebar included). The layout cannot see a page's session, so the
 * last one started is published here; /ride and /ramp stop theirs on destroy.
 */
let latest = $state.raw<{ state: RideState } | null>(null);
export const soloRide = {
	get active() {
		return !!latest && latest.state !== 'idle' && latest.state !== 'done';
	},
};

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
	sprint?: () => { grade: number; singleSpeed: boolean };
	/** Called with each recorded sample — the crash-safety buffer's seam (#19). */
	onRecord?: (sample: {
		second: number;
		clock: number;
		watts: number;
		cadence: number;
		heartRate: number;
		bias: number;
	}) => void;
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
	const segments: Segment[] = flatten(workout);
	const total = segments.reduce(
		(t, s) => Math.max(t, s.startSeconds + s.seconds),
		0,
	);

	const startedAt = new Date(startedAtMs ?? now());
	let elapsed = $state(0);
	let state = $state<RideState>('idle');
	let bias = $state(1);
	let sample = $state<TrainerSample | null>(null);
	/**
	 * Auto-pause and the spiral release, shared with the group path so a rider
	 * gets the same protection in a room as alone (#788). The mirrors below
	 * are what makes the machine's answers reactive here.
	 */
	const guards = createPersonalGuards();
	let resumeIn = $state(0);
	let spiralActive = $state(false);
	/** Per-segment time shifts from skip/extend, so the timeline stays authoritative. */
	let shift = $state(0);
	/** The ride's own power history, for the interval graph. Owned here rather than
	 *  rebuilt in the screen — a component effect that reads and writes it loops. */
	let trace = $state<{ t: number; w: number }[]>([]);
	/**
	 * What actually happened, in real time. Distinct from `trace`, which is keyed on
	 * the workout clock so it lines up with the interval graph — skip and extend make
	 * that clock jump, and a .fit needs strictly increasing seconds.
	 */
	const recording: {
		second: number;
		/**
		 * The workout second this sample was ridden at (#1733). `second` is
		 * the wall clock; this one stops while auto-paused and jumps on skip
		 * and extend, and it is the coordinate the score is keyed on — the
		 * server used to score the saved ride by array index, so a 30 s stop
		 * mid-block read every later second against the wrong block.
		 */
		clock: number;
		watts: number;
		cadence: number;
		heartRate: number;
		/**
		 * The trim this second was ridden at (#1530). The live score bands the
		 * BIASED target; the server re-scores the saved ride and bands whatever
		 * bias each sample carries — so a ride that never sends one is scored
		 * against the workout as written, and a rider who trims to 95 % reads
		 * 100 % on the summary and 93 % on the ride's own page.
		 */
		bias: number;
	}[] = [];
	let recordedSeconds = 0;
	// The wall-clock second the record last admitted a sample for: a trainer
	// notifies more than once a second and everything downstream — kJ,
	// duration, the power curve, the XP the server pays — reads this record
	// as one entry per second. Wall clock, not the ride clock: the ride clock
	// stops while auto-paused and the record must keep counting (the ramp's
	// blown-detector reads it). The room's recorder and the hub's admit the
	// same way (#1411, #791); this was the third recorder (audit 2026-09-09).
	let lastRecordedSecond = -1;

	// SPEC's execution score, accumulated as the ride happens: seconds inside
	// the band over seconds ridden, each weighed by the step's prescribed
	// intensity (target/FTP), warmup, cooldown and freeride excluded. It used
	// to count samples equally and include every targeted second, so the same
	// ride scored one number here and another one when the server saved it
	// (#795).
	let insideWeight = 0;
	let scoredWeight = 0;
	let ticker: Ticker | undefined;
	let wakeLock: WakeLock | undefined;
	let unsubscribe: (() => void) | undefined;

	const clockSeconds = $derived(Math.min(total, Math.max(0, elapsed + shift)));
	const info = $derived(targetAt(segments, ftp, clockSeconds, { bias }));

	/** Released during spiral guard and while auto-paused — both mean "no target". */
	const target = $derived(
		state === 'autopaused' || spiralActive ? 0 : (info.targetWatts ?? 0),
	);

	const execution = $derived(
		scoredWeight > 0 ? insideWeight / scoredWeight : 1,
	);
	const inBand = $derived(
		target > 0 &&
			sample !== null &&
			Math.abs(sample.watts - target) <= toleranceBand(target),
	);

	/**
	 * No ERG target because this is a sprint — not because a guard is up. The
	 * `?? 0` below folded both into zero, and zero in ERG is a freewheel: the
	 * rider pedalled against nothing for the whole window (#1529).
	 */
	const sprinting = $derived(!info.done && info.segment?.kind === 'sprint');

	/** True while the trainer is in slope for a sprint, so the flip happens once. */
	let sprintMode = false;

	function applyTarget() {
		if (sprinting) {
			// A sprint outranks the guards, for the reason the room gives
			// (room/ride.svelte.ts): auto-pause is an INFERENCE that the rider
			// left, a sprint is an announced effort they are about to answer.
			if (sprintMode) return;
			sprintMode = true;
			const setup = sprint();
			if (setup.singleSpeed) {
				// Slope has no usable range on a single-speed setup (Zwift Cog),
				// so the sprint runs as a target nobody holds instead (#30/#41).
				void trainer.setTargetPower(ftp * 2);
				return;
			}
			// Flat first, then the hill: the same two-step the room uses to get
			// an FTMS trainer out of ERG before the grade lands.
			void trainer.setSimulation(0);
			setTimeout(() => {
				if (sprintMode) void trainer.setSimulation(setup.grade);
			}, 500);
			return;
		}
		sprintMode = false;
		void trainer.setTargetPower(target);
	}

	/**
	 * The guards are a plain machine; these are its answers made reactive. The
	 * ride's own states — idle, done — are not the guards' to set.
	 */
	function syncGuards() {
		state = guards.phase;
		resumeIn = guards.resumeIn;
		spiralActive = guards.spiralActive;
	}

	function onSample(raw: TrainerSample) {
		// A paired power meter outranks the trainer, and a dedicated cadence sensor
		// outranks both (RESEARCH.md §11). Resolved here so the whole ride — targets,
		// auto-pause, execution, the .fit — reads one agreed set of numbers.
		const metrics = arbitrate({ trainer: raw, sensors: readings() }, raw.at);
		const next: TrainerSample = {
			watts: metrics.watts,
			cadence: metrics.cadence,
			heartRate: metrics.heartRate,
			at: raw.at,
		};
		sample = next;
		publish();
		// The record and the score admit one sample per ride second; the
		// guards below look at every one — a stop is noticed by the sample
		// that stopped, not by the second's first.
		const second = Math.floor(raw.at / 1000);
		const admit = second > lastRecordedSecond;
		if (admit) {
			lastRecordedSecond = second;
			const recorded = {
				second: recordedSeconds++,
				clock: clockSeconds,
				watts: Math.max(0, Math.round(next.watts)),
				cadence: Math.max(0, Math.round(next.cadence)),
				// Reaches the .fit export now that a strap can be paired (#11, #44).
				heartRate: Math.max(0, Math.round(next.heartRate ?? 0)),
				bias,
			};
			recording.push(recorded);
			onRecord?.(recorded);
			trace.push({ t: clockSeconds, w: next.watts });
			if (trace.length > 900) trace.shift();
		}

		// Auto-pause and the spiral guard, against the PRESCRIBED target: the one
		// the trainer holds is zero exactly when a guard is already up.
		const pedalling = guards.pedalling(next);
		if (state !== 'idle' && state !== 'done') {
			const actuate = guards.sample(next, info.targetWatts ?? 0);
			syncGuards();
			if (actuate) applyTarget();
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
			info.segment?.kind === 'steady'
		) {
			// The band is the rider's own biased target; the weight is the
			// intensity the workout asked for, so dialling down does not also
			// quietly reduce how much the second counts for. `target` is
			// already biased, so the prescribed one is target / bias.
			const weight = target / bias / ftp;
			scoredWeight += weight;
			if (Math.abs(next.watts - target) <= toleranceBand(target))
				insideWeight += weight;
		}
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
		if (state === 'idle' || state === 'done') return;
		publishHud({
			watts: sample?.watts ?? 0,
			target,
			remaining: Math.max(0, total - clockSeconds),
			label: workout.name,
			fault:
				sample && now() - sample.at > SIGNAL_LOST_MS ? 'trainer' : undefined,
		});
	}

	function tick(seconds = 1) {
		publish();
		if (state === 'resuming') {
			const actuate = guards.tick(seconds);
			syncGuards();
			if (actuate) applyTarget();
			return;
		}
		if (state !== 'running') return;

		if (spiralActive) {
			const actuate = guards.tick(seconds);
			syncGuards();
			if (actuate) applyTarget();
		}

		elapsed += seconds;
		if (clockSeconds >= total) {
			state = 'done';
			void trainer.setTargetPower(0);
			return;
		}
		applyTarget();
	}

	return {
		segments,
		total,
		get elapsed() {
			return clockSeconds;
		},
		get state() {
			return state;
		},
		get sample() {
			return sample;
		},
		get trace() {
			return trace;
		},
		/** The ride as recorded, for .fit export. */
		get recording() {
			return recording;
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
			return info;
		},
		get execution() {
			return execution;
		},
		/** False when the workout prescribed nothing to score (#1454, #1544). */
		get scored() {
			return scoredWeight > 0;
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

		async start() {
			if (trainer.status !== 'connected') await trainer.connect();
			unsubscribe = trainer.onSample(onSample);
			state = 'running';
			latest = {
				get state() {
					return state;
				},
			};
			applyTarget();
			ticker = createTicker(tick, { now });
			// The screen staying on is part of "a ride is running" — owned here so
			// /ride and /ramp cannot each forget it separately (#58).
			wakeLock = acquireWakeLock();
		},
		stop() {
			wakeLock?.release();
			ticker?.stop();
			unsubscribe?.();
			void trainer.setTargetPower(0);
			// Let go of the hardware (#1546): after the summary nothing owns
			// this link, and the next pairing screen showed an unpaired grid
			// over a connection that was still open — the room's unpair()
			// does the same.
			void trainer.disconnect();
			state = 'done';
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
			const next = segments[info.segmentIndex + 1];
			if (!next) return;
			shift += next.startSeconds - clockSeconds;
			applyTarget();
		},
		/**
		 * Hold the current block longer by rewinding the workout clock, which pushes
		 * this block's end out along with everything after it.
		 * Known edge: within the first `seconds` of the whole workout the clock floors
		 * at zero, so an early extend gives less than asked. Fixing it properly needs
		 * per-segment durations rather than one global shift — not worth it until a
		 * rider complains.
		 */
		extend(seconds: number) {
			shift -= seconds;
			applyTarget();
		},
		/** Exposed for the ride screen's clock display and tests. */
		tick,
		onSample,
	};
}
