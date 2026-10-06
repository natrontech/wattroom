import type { P2 } from '../placement/geom';
import type { Road } from '../placement/types';
import { cosDeg, sinDeg } from '../place/sine';
import type { Line } from '../terrain/lines';
import { ROAD_W } from '../terrain/road-profile';

/**
 * The props generator's way along its roads (#3076): turns as exact cosine
 * and sine pairs, a stroke's key as an integer, a line walked by arc length,
 * and the stretch of road a placement is measured against. Nothing here
 * calls a transcendental: placement lint.
 */

/** A turn as its cosine and sine: whole degrees from sine.ts's table, composed by + and ×, the same bits in every engine. */
export type Turn = readonly [c: number, s: number];
export const deg = (d: number): Turn => [cosDeg(d), sinDeg(d)];
export const turnBy = (a: Turn, b: Turn): Turn => [
	a[0] * b[0] - a[1] * b[1],
	a[1] * b[0] + a[0] * b[1],
];

/** A stroke's key as an integer, for the keys its slots take. */
export function hashOf(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++)
		h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
	return h >>> 0;
}

/** A line walked by arc length: where `s` metres along it is, which way it runs, and its height. */
export function walker(l: Line) {
	const n = l.x.length;
	const arc = new Float64Array(n);
	for (let i = 1; i < n; i++)
		arc[i] =
			arc[i - 1] +
			Math.sqrt(
				(l.x[i] - l.x[i - 1]) * (l.x[i] - l.x[i - 1]) +
					(l.z[i] - l.z[i - 1]) * (l.z[i] - l.z[i - 1]),
			);
	function at(s: number) {
		const t = Math.min(Math.max(s, 0), arc[n - 1]);
		// The first segment that reaches t: the same whichever metre was asked before (#3699).
		let lo = 0;
		let hi = n - 2;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (arc[mid + 1] < t) lo = mid + 1;
			else hi = mid;
		}
		const seg = lo;
		const len = arc[seg + 1] - arc[seg] || 1;
		const f = (t - arc[seg]) / len;
		const dx = (l.x[seg + 1] - l.x[seg]) / len;
		const dz = (l.z[seg + 1] - l.z[seg]) / len;
		return {
			x: l.x[seg] + dx * f * len,
			z: l.z[seg] + dz * f * len,
			h: l.h[seg] + (l.h[seg + 1] - l.h[seg]) * f,
			// Left of travel in an x-east, z-south plane, and the turn that faces a model along the road.
			lx: dz,
			lz: -dx,
			along: [dz, dx] as Turn,
		};
	}
	return { length: arc[n - 1], at };
}

/** Vertices between two in the window before a line counts as passing it twice: 200 m at 2 m a row, wider than the window. */
const RUN_GAP = 100;

/** The roads near a spot, cut to the stretch that can matter: what #3219's O1 measures against. */
export function roadsNear(lines: readonly Line[]) {
	const CELL = 40;
	const buckets = new Map<string, [number, number][]>();
	lines.forEach((l, k) => {
		for (let i = 0; i < l.x.length; i++) {
			const id = `${Math.floor(l.x[i] / CELL)}:${Math.floor(l.z[i] / CELL)}`;
			const b = buckets.get(id);
			if (b) b.push([k, i]);
			else buckets.set(id, [[k, i]]);
		}
	});
	return (x: number, z: number): Road[] => {
		const near = new Map<number, number[]>();
		const ci = Math.floor(x / CELL);
		const cj = Math.floor(z / CELL);
		for (let dj = -2; dj <= 2; dj++)
			for (let di = -2; di <= 2; di++)
				for (const [k, i] of buckets.get(`${ci + di}:${cj + dj}`) ?? [])
					near.set(k, [...(near.get(k) ?? []), i]);
		// Each pass of a line through the window on its own: a loop's start and its end meet there without the whole loop between (#3699).
		const runs: [number, number, number][] = [];
		for (const [k, is] of near) {
			is.sort((a, b) => a - b);
			let a = is[0];
			for (let n = 1; n <= is.length; n++)
				if (n === is.length || is[n] - is[n - 1] > RUN_GAP) {
					runs.push([k, a, is[n - 1]]);
					a = is[n];
				}
		}
		return runs.map(([k, a, b]) => {
			const l = lines[k];
			const points: P2[] = [];
			// A few vertices past each end, for O1's reading of the bend.
			for (
				let i = Math.max(0, a - 6);
				i <= Math.min(l.x.length - 1, b + 6);
				i++
			)
				points.push([l.x[i], l.z[i]]);
			return { points, halfWidth: ROAD_W / 2 };
		});
	};
}
