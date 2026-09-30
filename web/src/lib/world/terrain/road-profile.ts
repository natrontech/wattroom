import { at, type RoutePoint } from '$lib/road/along';
import type { Route } from '$lib/road/route';

/**
 * The drawn road across its width (#3075): what the ribbon is drawn to and
 * what road furniture stands on, from one definition. Three-free, so the
 * ground and a worker can read it.
 */

export const ROAD_W = 6.4; // a two-lane Swiss mountain road
export const SHOULDER = 1.6;
/** The shoulder's outer edge tucks this far down, under the verge. */
export const SHOULDER_DROP = 0.38;
/** The edge of the shoulder: where the road's own earthwork ends. */
export const FORMATION = ROAD_W / 2 + SHOULDER;

/** The bank of a bend of curvature k (1/m, +left) at v ≈ 8 m/s: at most 4°. */
export const bankOf = (k: number): number =>
	Math.max(-0.07, Math.min(0.07, Math.atan((64 * k) / 9.81)));

/** The drawn surface `u` metres left of the centreline, against the centre's height. */
export function across(u: number, bank: number): number {
	const out = Math.min(1, Math.max(0, (Math.abs(u) - ROAD_W / 2) / SHOULDER));
	return -u * Math.tan(bank) - SHOULDER_DROP * out;
}

/**
 * The road as drawn: the spline riders ride, every `step` metres from the
 * start. The ribbon is built on these rows and the ground's line is them, so
 * the two agree on where the road is and how it banks.
 */
export function drawnRows(route: Route, step = 2): RoutePoint[] {
	const rows: RoutePoint[] = [];
	for (let d = 0; d <= route.length + 1e-6; d += step) rows.push(at(route, d));
	return rows;
}
