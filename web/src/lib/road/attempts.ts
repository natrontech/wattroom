/**
 * A route's attempts as its owner's chart reads them (#3615), from
 * GET /api/routes/{id}/attempts (#3033). Kept out of the SVG so the two
 * questions the chart asks — where each ride sits, and which way the timed
 * ones trend — are tested without a DOM.
 */

/** One ride of the road. */
export interface Attempt {
	rideId: string;
	startedAt: string;
	seconds: number;
	distanceM?: number;
	climbedM?: number;
	fromM?: number;
	/** ADR-0074's timeable ride is "timed", drawn solid; "together" and "erg" hollow. */
	kind: 'timed' | 'together' | 'erg';
}

/** The owner's best time up one classed climb of the road. */
export interface ClimbBest {
	startM: number;
	topM: number;
	cls: string;
	seconds: number;
	rideId: string;
}

export interface AttemptPoint {
	at: number;
	kmh: number;
	solid: boolean;
	rideId: string;
}

/**
 * Each ride at its average speed, oldest first. A route rides in legs, so a
 * time compares only over the same metres and a speed compares across them.
 * A ride saved before road metres were kept has no distance and no place.
 */
export function attemptPoints(attempts: Attempt[]): AttemptPoint[] {
	return attempts
		.filter((a) => (a.distanceM ?? 0) > 0 && a.seconds > 0)
		.map((a) => ({
			at: Date.parse(a.startedAt),
			kmh: ((a.distanceM ?? 0) / a.seconds) * 3.6,
			solid: a.kind === 'timed',
			rideId: a.rideId,
		}))
		.sort((p, q) => p.at - q.at);
}

/**
 * The least-squares line through the timed rides alone, from the first to
 * the last: a ride together or in ERG was not the rider's own pace, so it is
 * drawn and never trended. Null under two timed rides, or all on one instant.
 */
export function attemptTrend(
	points: AttemptPoint[],
): {
	from: { at: number; kmh: number };
	to: { at: number; kmh: number };
} | null {
	const timed = points.filter((p) => p.solid);
	if (timed.length < 2) return null;
	const mx = timed.reduce((s, p) => s + p.at, 0) / timed.length;
	const my = timed.reduce((s, p) => s + p.kmh, 0) / timed.length;
	let sxx = 0;
	let sxy = 0;
	for (const p of timed) {
		sxx += (p.at - mx) ** 2;
		sxy += (p.at - mx) * (p.kmh - my);
	}
	if (sxx === 0) return null;
	const at = (x: number) => ({ at: x, kmh: my + (sxy / sxx) * (x - mx) });
	return { from: at(timed[0].at), to: at(timed[timed.length - 1].at) };
}
