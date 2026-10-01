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
	let seg = 0;
	function at(s: number) {
		const t = Math.min(Math.max(s, 0), arc[n - 1]);
		while (seg > 0 && arc[seg] > t) seg--;
		while (seg < n - 2 && arc[seg + 1] < t) seg++;
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
		const span = new Map<number, [number, number]>();
		const ci = Math.floor(x / CELL);
		const cj = Math.floor(z / CELL);
		for (let dj = -2; dj <= 2; dj++)
			for (let di = -2; di <= 2; di++)
				for (const [k, i] of buckets.get(`${ci + di}:${cj + dj}`) ?? []) {
					const s = span.get(k);
					span.set(k, s ? [Math.min(s[0], i), Math.max(s[1], i)] : [i, i]);
				}
		return [...span].map(([k, [a, b]]) => {
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
