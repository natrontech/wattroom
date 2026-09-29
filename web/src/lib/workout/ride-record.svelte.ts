import type { GuardSample } from './guards';
import { toleranceBand } from './guards';
import type { RideState } from './ride-state';
import type { Segment } from './types';

/**
 * Whether a kept second counts toward execution. SPEC excludes auto-paused
 * time and untargeted blocks, and the grace seconds before auto-pause
 * engages — the rider had already stopped, we simply had not noticed yet. A
 * ramp is a warmup or a cooldown, which SPEC excludes as well: the server
 * has always agreed (workout.TargetAt reports those seconds unscored).
 */
export function countsToward(second: {
	state: RideState;
	target: number;
	pedalling: boolean;
	segment: Segment | undefined;
}): boolean {
	return (
		second.state === 'running' &&
		second.target > 0 &&
		second.pedalling &&
		second.segment?.kind === 'steady' &&
		!second.segment.hrHold // never scored (ADR-0008)
	);
}

/** One ride second as recorded, for .fit export and the crash-safety buffer (#19). */
export interface RecordedSecond {
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
	/**
	 * The guard had the trainer off the target this second (#1796):
	 * paused, counting back in, or released. The live score skips it;
	 * so must the saved one.
	 */
	released: boolean;
}

/**
 * What a solo ride did: the record, the trace the graph draws, and the
 * execution score as it accrues.
 */
export function createRideRecord(ftp: number) {
	/** The ride's own power history, for the interval graph. Owned here rather than
	 *  rebuilt in the screen — a component effect that reads and writes it loops. */
	// Raw, replaced on each push (#2878): see createRecording.
	let trace = $state.raw<{ t: number; w: number }[]>([]);
	/**
	 * What actually happened, in real time. Distinct from `trace`, which is keyed on
	 * the workout clock so it lines up with the interval graph — skip and extend make
	 * that clock jump, and a .fit needs strictly increasing seconds.
	 */
	const recording: RecordedSecond[] = [];
	let recordedSeconds = 0;
	// The wall-clock second the record last admitted a sample for: a trainer
	// notifies more than once a second and everything downstream — kJ,
	// duration, the power curve, the XP the server pays — reads this record
	// as one entry per second. Wall clock, not the ride clock: the ride clock
	// stops while auto-paused and the record must keep counting (the ramp's
	// blown-detector reads it). The session's recorder and the hub's admit the
	// same way (#1411, #791); this was the third recorder (audit 2026-09-09).
	let lastRecordedSecond = -1;

	// SPEC's execution score, accumulated as the ride happens: seconds inside
	// the band over seconds ridden, each weighed by the step's prescribed
	// intensity (target/FTP), warmup, cooldown and freeride excluded. It used
	// to count samples equally and include every targeted second, so the same
	// ride scored one number here and another one when the server saved it
	// (#795). State, because the numbers row reads it live (#2769): as plain
	// variables the score froze at its first read and the cell never appeared.
	let insideWeight = $state(0);
	let scoredWeight = $state(0);
	const execution = $derived(
		scoredWeight > 0 ? insideWeight / scoredWeight : 1,
	);

	return {
		get recording() {
			return recording;
		},
		get trace() {
			return trace;
		},
		get execution() {
			return execution;
		},
		/** False when the workout prescribed nothing to score (#1454, #1544). */
		get scored() {
			return scoredWeight > 0;
		},
		/** Whether a sample at `at` opens a new wall-clock second. */
		admits(at: number): boolean {
			return Math.floor(at / 1000) > lastRecordedSecond;
		},
		/** The second a sample at `at` opens, kept; what was kept is returned. */
		add(
			at: number,
			clock: number,
			sample: { watts: number; cadence: number; heartRate?: number },
			bias: number,
			released: boolean,
		): RecordedSecond {
			lastRecordedSecond = Math.floor(at / 1000);
			const recorded = {
				second: recordedSeconds++,
				clock,
				watts: Math.max(0, Math.round(sample.watts)),
				cadence: Math.max(0, Math.round(sample.cadence)),
				// Reaches the .fit export now that a strap can be paired (#11, #44).
				heartRate: Math.max(0, Math.round(sample.heartRate ?? 0)),
				bias,
				released,
			};
			recording.push(recorded);
			// Uncapped, for the reason session/recording.svelte.ts gives: the graph
			// is keyed on the workout clock, so dropping the oldest entries
			// erased the start of the line rather than scrolling it (#2017).
			trace = [...trace, { t: clock, w: sample.watts }];
			return recorded;
		},
		/**
		 * One scored second. The band is the rider's own biased target; the
		 * weight is the intensity the workout asked for, so dialling down does
		 * not also quietly reduce how much the second counts for. `target` is
		 * already biased, so the prescribed one is target / bias.
		 */
		score(watts: number, target: number, bias: number) {
			const weight = target / bias / ftp;
			scoredWeight += weight;
			if (Math.abs(watts - target) <= toleranceBand(target))
				insideWeight += weight;
		},
		/**
		 * The trailing run of not pedalling, off a ride that ended itself (#2622):
		 * those seconds are the rider gone, not riding, so they stay out of its
		 * duration, its normalised power and the .fit. Read by the guards' own
		 * definition of stopped, so the grace seconds before the pause go too.
		 */
		trimStoppedTail(pedalling: (sample: GuardSample) => boolean) {
			let keep = recording.length;
			while (keep > 0 && !pedalling(recording[keep - 1])) keep--;
			const cut = recording.length - keep;
			if (cut === 0) return;
			recording.length = keep;
			trace = trace.slice(0, Math.max(0, trace.length - cut));
		},
	};
}
