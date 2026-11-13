import { at, closes, wrapAngle, type RoutePoint } from '#lib/road/along.ts';
import type { Route } from '#lib/road/route.ts';
import type { Road } from '#lib/road/road.ts';
import type { Line } from './lines';

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
 * start — rows `from` to `to` of it. The ribbon is built on these rows and
 * the ground's line is them, so the two agree on where the road is and how
 * it banks.
 */
export function drawnRows(
	route: Route,
	step = 2,
	from = 0,
	to = Infinity,
): RoutePoint[] {
	const rows: RoutePoint[] = [];
	for (let k = from; k <= to && k * step <= route.length + 1e-6; k++)
		rows.push(at(route, k * step));
	return rows;
}

/** How many rows the road's line has, `step` metres apart: the ground's. */
export const rowCount = (route: Route, step = 2): number =>
	Math.floor((route.length + 1e-6) / step) + 1;

/**
 * Whether the drawn road goes round (#4534): its ends meet, as a loop's do
 * (closes), and it leaves its start the way it came back to it. An
 * out-and-back that ends on its start turns there, and keeps its two ends.
 * Whether a ride laps it is the ride's to say (compose.ts); a road that goes
 * round is drawn round either way.
 */
export function ringOf(route: Route): boolean {
	const n = route.x.length - 1;
	if (n < 3 || !closes({ ...route, loop: true })) return false;
	const came = Math.atan2(
		route.x[n] - route.x[n - 1],
		route.z[n] - route.z[n - 1],
	);
	const leaves = Math.atan2(route.x[1] - route.x[0], route.z[1] - route.z[0]);
	return Math.abs(wrapAngle(leaves - came)) < Math.PI / 4;
}

/** Metres apart, at most, the road's two ends are one place: on one road, a road's width. A ring's meet and a street's out and back is drawn on itself, both to the metre; a hairpin's two legs are two roads, an arch each. */
const HOME_M = ROAD_W;

/**
 * Whether the road ends where it began, whichever way it comes home: a
 * loop ridden once, or out and back along one street. Its start arch and
 * its finish arch stood in each other there, their banners through one
 * another; one arch stands for both (stage.ts).
 */
export function endsMeet(route: Route): boolean {
	const n = route.x.length - 1;
	return Math.hypot(route.x[n] - route.x[0], route.z[n] - route.z[0]) < HOME_M;
}

/**
 * The ribbon's rows (#4534), `step` metres apart from the start: the road's
 * line, except that a road that goes round (ringOf) is one strip round. Its
 * last row stands on the road's last metre, which is its start, so the last
 * cross-section is the first: no gap and no overlap at the start line. Its
 * row before that is the last whole step at least a quarter step short of
 * it. Any row number names a row of a ring, wrapping round, so a piece by
 * the start walks in from the end. On a road with two ends this is the
 * line's rows, 0 to count − 1.
 */
export function ribbonRows(route: Route, step = 2) {
	const ring = ringOf(route);
	if (!ring)
		return {
			ring,
			count: rowCount(route, step),
			metre: (k: number) => k * step,
			row: (k: number) => at(route, k * step),
		};
	const round = { ...route, loop: true };
	const per = Math.max(3, Math.ceil(route.length / step - 0.25));
	const metre = (k: number) => {
		const lap = Math.floor(k / per);
		return lap * route.length + (k - lap * per) * step;
	};
	return {
		ring,
		count: per + 1,
		metre,
		row: (k: number) => at(round, metre(k)),
	};
}

/**
 * A stroke as the road library keeps a road (#3047's shape): heights and
 * whole-degree turns every ~20 m, so `climbsOf` and `hairpinsOf` read a
 * stroke as they read any road (#3077). Its turns are rounded to the degree,
 * so no engine's last bit moves one.
 */
export function strokeRoad(line: Line, every = 20): Road {
	const n = line.x.length;
	const arc = new Float64Array(n);
	for (let i = 1; i < n; i++)
		arc[i] =
			arc[i - 1] +
			Math.hypot(line.x[i] - line.x[i - 1], line.z[i] - line.z[i - 1]);
	const length = arc[n - 1];
	const samples = Math.max(2, Math.round(length / every) + 1);
	const step = length / (samples - 1);
	const xs: number[] = [];
	const zs: number[] = [];
	const heights: number[] = [];
	let seg = 0;
	for (let k = 0; k < samples; k++) {
		const s = Math.min(k * step, length);
		while (seg < n - 2 && arc[seg + 1] < s) seg++;
		const f = (s - arc[seg]) / (arc[seg + 1] - arc[seg] || 1);
		xs.push(line.x[seg] + (line.x[seg + 1] - line.x[seg]) * f);
		zs.push(line.z[seg] + (line.z[seg + 1] - line.z[seg]) * f);
		heights.push(
			Math.round((line.h[seg] + (line.h[seg + 1] - line.h[seg]) * f) * 100) /
				100,
		);
	}
	const heading = (k: number) =>
		Math.atan2(xs[k + 1] - xs[k], zs[k + 1] - zs[k]);
	const turns: number[] = [];
	for (let k = 0; k < samples - 1; k++) {
		if (k === 0) {
			turns.push(0);
			continue;
		}
		let d = heading(k) - heading(k - 1);
		if (d > Math.PI) d -= 2 * Math.PI;
		if (d <= -Math.PI) d += 2 * Math.PI;
		turns.push(Math.round((d * 180) / Math.PI));
	}
	return { length: Math.round(length * 100) / 100, heights, turns };
}
