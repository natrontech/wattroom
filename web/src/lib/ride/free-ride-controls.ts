import { MaxTrainerGrade } from '$lib/protocol';
import { ROAD } from '$lib/ride/ride-grade';

/**
 * docs/SPEC.md's free ride (ADR-0059) — defaults, tune in alpha. Its grade
 * range is the felt grade's: the felt floor, and ADR-0062's one ceiling.
 */
export const GRADE = {
	step: 0.5,
	min: ROAD.feltMin,
	max: MaxTrainerGrade,
} as const;
export const WATTS = { step: 10, min: 50, max: 1000 } as const;
const OPENING_FTP_FRACTION = 0.55;

export type FreeMode = 'grade' | 'watts';

const clamp = (value: number, { min, max }: { min: number; max: number }) =>
	Math.min(max, Math.max(min, value));

/** Where watts mode opens: an easy spin, on the 10 W grid. */
export function openingWatts(ftp: number): number {
	return clamp(
		Math.round((OPENING_FTP_FRACTION * ftp) / WATTS.step) * WATTS.step,
		WATTS,
	);
}

/** One press of − or +, snapped to the mode's grid and held in its bounds. */
export function nudged(mode: FreeMode, value: number, dir: 1 | -1): number {
	const range = mode === 'grade' ? GRADE : WATTS;
	const next = Math.round((value + dir * range.step) / range.step) * range.step;
	return clamp(next, range);
}
