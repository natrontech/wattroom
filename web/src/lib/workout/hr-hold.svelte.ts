import { SIGNAL_LOST_MS } from './ride-state';
import type { Segment } from './types';
import { LIMITS } from './validate';

/**
 * docs/SPEC.md "HR hold" (#67 flavour 2; defaults — tune in alpha), each
 * number with its source there.
 */
export const HR_HOLD = {
	/** Never further than this from the step's biased target, in FTP. */
	window: 0.1,
	/** One adjustment this often: heart rate lags effort by 30 s to 2 min. */
	intervalMs: 60_000,
	/** At most this far per adjustment, in FTP. */
	step: 0.02,
	/** Heart rate averaged over this long. */
	smoothingMs: 10_000,
	/** A reading older than this is lost — the dashboard's own rule (#37). */
	freshMs: SIGNAL_LOST_MS,
} as const;

/**
 * HR hold (#67): moves a steady step's ERG watts to keep heart rate in the
 * step's band. Slow and damped on purpose — one small step a minute, inside
 * a window around the target — because heart rate lags effort, and a loop
 * that chases the lag swings ±40 W. A ceiling alone is a cap: it only ever
 * lowers the watts. It never raises them without a fresh, plausible reading.
 *
 * The rider's own client only: never scored, never shared (ADR-0008).
 */
export function createHrHold(ftp: number) {
	// Watts off the biased target, reactive: the ride's target reads it.
	let offset = $state(0);
	// Holding, with no fresh plausible heart rate: persistent status.
	let lost = $state(false);
	let readings: { bpm: number; at: number }[] = [];
	let step: number | undefined;
	let since = 0;

	const window = HR_HOLD.window * ftp;
	const plausible = (bpm: number) => bpm >= LIMITS.minHr && bpm <= LIMITS.maxHr;
	const capOnly = (s: Segment) => s.hrLow === undefined;

	function heart(now: number): number | undefined {
		readings = readings.filter((r) => now - r.at <= HR_HOLD.smoothingMs);
		const last = readings.at(-1);
		if (!last || now - last.at > HR_HOLD.freshMs || !plausible(last.bpm))
			return undefined;
		const kept = readings.filter((r) => plausible(r.bpm));
		return kept.reduce((sum, r) => sum + r.bpm, 0) / kept.length;
	}

	return {
		/** One heart-rate reading, from whichever source arbitration chose. */
		reading(bpm: number | undefined, at: number) {
			if (bpm !== undefined) readings.push({ bpm, at });
		},
		/** A second of the ride: the hold adjusts once a minute into its step. */
		tick(segment: Segment | undefined, now: number) {
			if (!segment?.hrHold) {
				step = undefined;
				offset = 0;
				lost = false;
				return;
			}
			if (step !== segment.startSeconds) {
				step = segment.startSeconds;
				offset = 0;
				since = now;
			}
			const bpm = heart(now);
			lost = bpm === undefined;
			if (now - since < HR_HOLD.intervalMs) return;
			since = now;
			if (bpm === undefined) return;
			const move = HR_HOLD.step * ftp;
			let next = offset;
			if (segment.hrHigh !== undefined && bpm > segment.hrHigh) next -= move;
			else if (segment.hrLow !== undefined && bpm < segment.hrLow) next += move;
			offset = Math.min(capOnly(segment) ? 0 : window, Math.max(-window, next));
		},
		/** The watts for this step at its biased target: the target itself unless it holds. */
		watts(segment: Segment | undefined, target: number): number {
			return segment?.hrHold && target > 0 ? target + offset : target;
		},
		/** Holding with no fresh, plausible heart rate: the watts stay where they are. */
		get lost() {
			return lost;
		},
	};
}
