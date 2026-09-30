import { at, type RoutePoint } from '$lib/road/along';
import type { Route } from '$lib/road/route';
import type { Road } from '$lib/road/road';
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
 * start. The ribbon is built on these rows and the ground's line is them, so
 * the two agree on where the road is and how it banks.
 */
export function drawnRows(route: Route, step = 2): RoutePoint[] {
	const rows: RoutePoint[] = [];
	for (let d = 0; d <= route.length + 1e-6; d += step) rows.push(at(route, d));
	return rows;
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
		arc[i] = arc[i - 1] + Math.hypot(line.x[i] - line.x[i - 1], line.z[i] - line.z[i - 1]);
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
		heights.push(Math.round((line.h[seg] + (line.h[seg + 1] - line.h[seg]) * f) * 100) / 100);
	}
	const heading = (k: number) => Math.atan2(xs[k + 1] - xs[k], zs[k + 1] - zs[k]);
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
