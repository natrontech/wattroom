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
	return snappedWatts(OPENING_FTP_FRACTION * ftp);
}

/** One press of − or +, snapped to the mode's grid and held in its bounds. */
export function nudged(mode: FreeMode, value: number, dir: 1 | -1): number {
	const range = mode === 'grade' ? GRADE : WATTS;
	const next = Math.round((value + dir * range.step) / range.step) * range.step;
	return clamp(next, range);
}

/** docs/SPEC.md's free-ride ramps (#4100): fractions of FTP, minutes at a tap. */
export const RAMP = {
	minutes: [5, 10],
	warmup: { from: 0.4, to: 0.7 },
	cooldownFloor: 0.35,
	/** How long the ride says a ramp is done, in counted seconds. */
	doneSeconds: 10,
} as const;
export type RampKind = 'warmup' | 'cooldown';

/** On the 10 W grid and in watts mode's bounds. */
export const snappedWatts = (w: number): number =>
	clamp(Math.round(w / WATTS.step) * WATTS.step, WATTS);

/**
 * A ramp's watts `t` counted seconds in, interpolated as a workout's ramp is
 * (docs/spec/workouts.md); at or past its length, its `to`.
 */
export function rampWatts(
	ramp: { from: number; to: number; seconds: number },
	t: number,
): number {
	const into = Math.min(Math.max(t, 0), ramp.seconds) / ramp.seconds;
	return snappedWatts(ramp.from + (ramp.to - ramp.from) * into);
}

/**
 * The road a ride hands the session picker (#4224), so a session started
 * from it rides on: the rider's own, never a borrowed one, which is a mate's
 * and cannot go in a session (#3621).
 */
export const ownRoad = (
	road: { id: string; borrowed?: boolean } | null | undefined,
): string | undefined => (road && !road.borrowed ? road.id : undefined);
