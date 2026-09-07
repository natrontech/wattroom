/**
 * This ride against your own best of the same workout (#996).
 *
 * Nothing here needs the server: `GET /api/rides` already returns the workout
 * name, average watts, energy and execution for every ride, so the comparison
 * is arithmetic over a list the app fetches anyway.
 *
 * Describe, never grade (ADR-0016). A delta is a number, and a negative one is
 * a lighter day rather than a failure — callers render it muted, never in the
 * danger token. Nothing here returns a verdict, and execution appears as one
 * number among others: docs/RESEARCH.md §13.4 is explicit that 100 % in-band
 * on a recovery spin and on 5×5 VO2 are not the same achievement, so it is
 * never summed, ranked, or called fitness.
 */
import type { RideRecord } from '$lib/history.svelte';

export interface CompareRow {
	label: string;
	today: string;
	best: string;
	/** Signed, already formatted. Empty when the two are equal. */
	delta: string;
}

/**
 * The hardest past ride of the same workout, by average watts — one ride, so
 * the "your best" column is a session that actually happened rather than a
 * row assembled from four different days' bests.
 *
 * Same workout means same name: it is what a rider chose, and the only handle
 * the ride record carries. A renamed copy compares as a different workout,
 * which is the honest answer — its steps may differ too.
 */
export function bestOfWorkout(
	rides: RideRecord[],
	workoutName: string,
	excludeId: string,
): RideRecord | null {
	let best: RideRecord | null = null;
	for (const ride of rides) {
		if (ride.id === excludeId || ride.workoutName !== workoutName) continue;
		if (!best || ride.avgWatts > best.avgWatts) best = ride;
	}
	return best;
}

function signed(n: number, unit = ''): string {
	if (n === 0) return '';
	return `${n > 0 ? '+' : '−'}${Math.abs(n)}${unit}`;
}

/** The comparison table's rows, in reading order. */
export function compareRows(today: RideRecord, best: RideRecord): CompareRow[] {
	const pct = (r: RideRecord) => Math.round(r.execution * 100);
	return [
		{
			label: 'average',
			today: `${today.avgWatts} W`,
			best: `${best.avgWatts} W`,
			delta: signed(today.avgWatts - best.avgWatts, ' W'),
		},
		{
			label: 'execution',
			today: `${pct(today)}%`,
			best: `${pct(best)}%`,
			delta: signed(pct(today) - pct(best), ' pt'),
		},
		{
			label: 'energy',
			today: `${today.kj} kJ`,
			best: `${best.kj} kJ`,
			delta: signed(today.kj - best.kj, ' kJ'),
		},
	];
	// ponytail: no time-in-zone row. Zone seconds need each ride's per-second
	// samples, which only the single-ride blob carries — comparing them would
	// mean fetching every past ride's blob. The upgrade path is a stored
	// per-ride zone summary, not a fan-out of reads.
}

/**
 * The 20-minute curve, said honestly. `d30` ⊂ `d90` (PowerCurveChart calls
 * them nested recency windows), so `d30 − d90` is never positive and is not a
 * trend — rendering it as one would tell every rider they are declining,
 * permanently, which is the opposite of the always-good-news property
 * docs/RESEARCH.md §13.3 credits power-curve bests with.
 *
 * So: name each window and its number, and say when the 90-day best is recent.
 * A real "now versus 90 days ago" needs a curve over a past window, which the
 * API does not return (#996).
 */
export function curveSentence(d30: number, d90: number): string | null {
	if (d90 <= 0) return null;
	if (d30 >= d90) {
		return `Your best 20-minute power in 90 days is ${d90} W — and you set it in the last 30.`;
	}
	return `Your best 20-minute power is ${d90} W across 90 days, ${d30} W in the last 30.`;
}
