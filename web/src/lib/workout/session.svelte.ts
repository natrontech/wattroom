import { arbitrate } from '$lib/ble/arbitrate';
import type { SensorKind, SensorReading } from '$lib/ble/sensor';
import type { Trainer, TrainerSample } from '$lib/ble/trainer';
import { flatten, targetAt } from './engine';
import { createTicker, type Ticker } from './ticker';
import type { Segment, Workout } from './types';

/**
 * Defaults — tune in alpha, the way docs/SPEC.md marks its own. None of these are
 * specced yet; #13 proposes adding them once they have been ridden.
 */
export const DEFAULTS = {
	/** Below this cadence AND below pedallingWatts, the rider has stopped. */
	pauseCadence: 5,
	/**
	 * Power floor for "still pedalling". Cadence alone is not safe: a Kickr v2 reports
	 * no cadence at all (RESEARCH.md §9), and keying auto-pause on cadence would leave
	 * those riders permanently paused mid-ride.
	 */
	pedallingWatts: 20,
	/** Seconds of not-pedalling before their targets pause. */
	pauseAfterSeconds: 3,
	/** Countdown shown when they start again, so resuming is not a jump-scare. */
	resumeCountdown: 3,
	/** Spiral guard: cadence under this while an ERG target is held. */
	spiralCadence: 50,
	/** ...for this long, before the target is released. */
	spiralAfterSeconds: 5,
	/** No cadence source? Fall back to power collapsing this far under target. */
	spiralPowerFraction: 0.5,
	/** How long the target stays released once the guard trips. */
	spiralReleaseSeconds: 10,
	/** Bias step and range for the ±% control. */
	biasStep: 0.01,
	biasMin: 0.8,
	biasMax: 1.2,
} as const;

/** docs/SPEC.md: within ±5 % of target, floor ±10 W. */
export function toleranceBand(target: number): number {
	return Math.max(target * 0.05, 10);
}

export type RideState = 'idle' | 'running' | 'autopaused' | 'resuming' | 'done';

export interface RideOptions {
	trainer: Trainer;
	workout: Workout;
	ftp: number;
	/** Injected so tests can drive the clock; defaults to wall time. */
	now?: () => number;
	/**
	 * Latest reading from each paired sensor (#11). Read per sample rather than
	 * subscribed to, because arbitration is a snapshot question — which source wins
	 * *right now* — and a sensor that has gone quiet has to lose on staleness.
	 */
	readings?: () => Partial<Record<SensorKind, SensorReading>>;
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
	readings = () => ({}),
}: RideOptions) {
	const segments: Segment[] = flatten(workout);
	const total = segments.reduce(
		(t, s) => Math.max(t, s.startSeconds + s.seconds),
		0,
	);

	const startedAt = new Date(now());
	let elapsed = $state(0);
	let state = $state<RideState>('idle');
	let bias = $state(1);
	let sample = $state<TrainerSample | null>(null);
	let resumeIn = $state(0);
	let spiralUntil = $state(0);
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
		watts: number;
		cadence: number;
		heartRate: number;
	}[] = [];
	let recordedSeconds = 0;

	let insideBand = 0;
	let ridden = 0;
	let idleSeconds = 0;
	let lowCadenceSeconds = 0;
	let ticker: Ticker | undefined;
	let unsubscribe: (() => void) | undefined;

	const clockSeconds = $derived(Math.min(total, Math.max(0, elapsed + shift)));
	const info = $derived(targetAt(segments, ftp, clockSeconds, { bias }));
	const spiralActive = $derived(spiralUntil > 0);

	/** Released during spiral guard and while auto-paused — both mean "no target". */
	const target = $derived(
		state === 'autopaused' || spiralActive ? 0 : (info.targetWatts ?? 0),
	);

	const execution = $derived(ridden > 0 ? insideBand / ridden : 1);
	const inBand = $derived(
		target > 0 &&
			sample !== null &&
			Math.abs(sample.watts - target) <= toleranceBand(target),
	);

	function applyTarget() {
		void trainer.setTargetPower(target);
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
		recording.push({
			second: recordedSeconds++,
			watts: Math.max(0, Math.round(next.watts)),
			cadence: Math.max(0, Math.round(next.cadence)),
			// Reaches the .fit export now that a strap can be paired (#11, #44).
			heartRate: Math.max(0, Math.round(next.heartRate ?? 0)),
		});
		trace.push({ t: clockSeconds, w: next.watts });
		if (trace.length > 900) trace.shift();

		// Auto-pause: their targets stop, the clock does not rewind.
		const pedalling =
			next.cadence >= DEFAULTS.pauseCadence ||
			next.watts >= DEFAULTS.pedallingWatts;
		if (!pedalling && state === 'running') {
			idleSeconds += 1;
			if (idleSeconds >= DEFAULTS.pauseAfterSeconds) {
				state = 'autopaused';
				applyTarget();
			}
		} else if (pedalling) {
			idleSeconds = 0;
			if (state === 'autopaused') {
				state = 'resuming';
				resumeIn = DEFAULTS.resumeCountdown;
			}
		}

		// Spiral guard. Cadence is the good signal; power collapse is the fallback when
		// no cadence source exists at all (RESEARCH.md §9 — the Kickr v2 case).
		if (state === 'running' && target > 0 && !spiralActive) {
			const collapsing =
				next.cadence > 0
					? next.cadence < DEFAULTS.spiralCadence
					: next.watts < target * DEFAULTS.spiralPowerFraction;
			lowCadenceSeconds = collapsing ? lowCadenceSeconds + 1 : 0;
			if (lowCadenceSeconds >= DEFAULTS.spiralAfterSeconds) {
				spiralUntil = DEFAULTS.spiralReleaseSeconds;
				lowCadenceSeconds = 0;
				applyTarget();
			}
		}

		// Execution excludes auto-paused time and untargeted blocks (docs/SPEC.md). The
		// grace seconds before auto-pause engages are excluded too — the rider had
		// already stopped, we simply had not noticed yet.
		if (state === 'running' && target > 0 && pedalling) {
			ridden += 1;
			if (Math.abs(next.watts - target) <= toleranceBand(target))
				insideBand += 1;
		}
	}

	/**
	 * Advance the ride by `seconds`. Normally one, but a throttled or delayed tick
	 * reports the seconds it actually covers (#51) — the ride catches up in a jump
	 * rather than running slow for as long as the tab stays hidden.
	 */
	function tick(seconds = 1) {
		if (state === 'resuming') {
			resumeIn -= seconds;
			if (resumeIn <= 0) {
				state = 'running';
				applyTarget();
			}
			return;
		}
		if (state !== 'running') return;

		if (spiralUntil > 0) {
			spiralUntil = Math.max(0, spiralUntil - seconds);
			if (spiralUntil === 0) applyTarget();
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
			applyTarget();
			ticker = createTicker(tick, { now });
		},
		stop() {
			ticker?.stop();
			unsubscribe?.();
			void trainer.setTargetPower(0);
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
