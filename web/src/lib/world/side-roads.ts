/**
 * The other roads of a map, as the road ridden meets them (designed.ts): a
 * map's loops share stretches of road, and where another loop leaves the
 * one ridden its road is there to see, a junction and a road going off to
 * the lake or up the pass. Each is a stretch of that loop's own line, from
 * where it leaves this road (or a stretch already kept) to where it comes
 * back: a road with two ends, drawn and built on as the ridden one is,
 * never ridden. Three-free.
 *
 * A side road ends at the edge of the road it meets, its mouth: the two
 * ribbons never lie in one another, and the stage paints the junction over
 * the gap (scenery.ts).
 */
import type { Route } from '#lib/road/route.ts';
import { FORMATION } from './terrain/road-profile';

/** A side road is one where its line is this far from every road kept so far: past both formations. */
const CLEAR_M = 11;
/** And it ends this far from the centre of the road it meets: just past that road's formation. */
export const MOUTH_M = FORMATION + 0.2;
/** A stretch shorter than this is two roads brushing past one another, not a road. */
const MIN_M = 40;
/** Metres a side road is followed back towards the road it leaves, at the most: one leaving at a shallower angle than that is cut where it is, with a rounded end. */
const REACH_M = 70;
/** Samples over which a side road's end eases to the height of the road it meets. */
const EASE = 12;
const CELL_M = 16;

/** Where a side road meets a road: the end of its line, the way across to that road's centre, and that road's height there. */
export type Mouth = {
	x: number;
	z: number;
	/** Unit, from the side road's end to the road met. */
	tx: number;
	tz: number;
	h: number;
};
export type SideRoad = {
	route: Route;
	/** Its first end's mouth and its last's; null where it ends in the open, a lane's far end. */
	mouths: [Mouth | null, Mouth | null];
};

export function sideRoads(route: Route, others: readonly Route[]): SideRoad[] {
	const kept = new Map<string, number[]>();
	const keep = (x: number, z: number, h: number) => {
		const k = `${Math.floor(x / CELL_M)}:${Math.floor(z / CELL_M)}`;
		const cell = kept.get(k);
		if (cell) cell.push(x, z, h);
		else kept.set(k, [x, z, h]);
	};
	/** The kept point nearest (x, z) within CLEAR_M: how far, where, and its height. */
	const nearest = (x: number, z: number) => {
		const ci = Math.floor(x / CELL_M);
		const cj = Math.floor(z / CELL_M);
		let best = CLEAR_M;
		let hit: { d: number; x: number; z: number; h: number } | null = null;
		for (let i = ci - 1; i <= ci + 1; i++)
			for (let j = cj - 1; j <= cj + 1; j++) {
				const cell = kept.get(`${i}:${j}`);
				if (!cell) continue;
				for (let k = 0; k < cell.length; k += 3) {
					const d = Math.hypot(cell[k] - x, cell[k + 1] - z);
					if (d < best) {
						best = d;
						hit = { d, x: cell[k], z: cell[k + 1], h: cell[k + 2] };
					}
				}
			}
		return hit;
	};
	/** A line's point `m` metres along it, between its samples. */
	const at = (r: Route, m: number) => {
		const f = Math.min(Math.max(m / r.step, 0), r.x.length - 1);
		const i = Math.min(Math.floor(f), r.x.length - 2);
		const t = f - i;
		return {
			x: r.x[i] + (r.x[i + 1] - r.x[i]) * t,
			z: r.z[i] + (r.z[i + 1] - r.z[i]) * t,
			ele: r.ele[i] + (r.ele[i + 1] - r.ele[i]) * t,
			grade: r.grade[i],
		};
	};
	/** A line's points every metre, kept. */
	const keepAll = (r: Route) => {
		const end = (r.x.length - 1) * r.step;
		for (let m = 0; m <= end; m += 1) {
			const p = at(r, m);
			keep(p.x, p.z, p.ele);
		}
	};
	keepAll(route);
	const out: SideRoad[] = [];
	for (const other of others) {
		const n = other.x.length;
		const end = (n - 1) * other.step;
		const runs: [number, number][] = [];
		let from = -1;
		for (let i = 0; i <= n; i++) {
			const free = i < n && !nearest(other.x[i], other.z[i]);
			if (free && from < 0) from = i;
			if (!free && from >= 0) {
				runs.push([from * other.step, (i - 1) * other.step]);
				from = -1;
			}
		}
		const sides: SideRoad[] = [];
		for (const [a, b] of runs) {
			// Along its own line towards the road it leaves, a metre at a time, to that road's edge: its mouth.
			const mouth = (m: number, dir: number): [number, Mouth | null] => {
				for (let by = 0; by <= REACH_M; by++) {
					const at0 = m + dir * by;
					if (at0 < 0 || at0 > end)
						return [Math.min(Math.max(at0, 0), end), null];
					const p = at(other, at0);
					const hit = nearest(p.x, p.z);
					if (hit && hit.d <= MOUTH_M) {
						const d = hit.d || 1;
						return [
							at0,
							{
								x: p.x,
								z: p.z,
								tx: (hit.x - p.x) / d,
								tz: (hit.z - p.z) / d,
								h: hit.h,
							},
						];
					}
				}
				return [m + dir * REACH_M, null];
			};
			const [startM, first] = mouth(a, -1);
			const [endM, last] = mouth(b, 1);
			const length = endM - startM;
			if (length < MIN_M) continue;
			const count = Math.max(2, Math.round(length / other.step) + 1);
			const step = length / (count - 1);
			const pts = Array.from({ length: count }, (_, k) =>
				at(other, startM + k * step),
			);
			// It meets a road at that road's height: two lines drawn apart agree to a metre or two, and the ground has one height at a spot.
			const ele = Float64Array.from(pts, (p) => p.ele);
			[first, last].forEach((m, which) => {
				if (!m) return;
				const endAt = which === 0 ? 0 : count - 1;
				const by = m.h - ele[endAt];
				for (let k = 0; k <= Math.min(EASE, count - 1); k++) {
					const t = 1 - k / EASE;
					ele[which === 0 ? k : count - 1 - k] += by * t * t * (3 - 2 * t);
				}
			});
			sides.push({
				route: {
					...other,
					step,
					length,
					x: Float64Array.from(pts, (p) => p.x),
					z: Float64Array.from(pts, (p) => p.z),
					ele,
					grade: Float64Array.from(pts, (p) => p.grade),
					loop: false,
					// One height datum for everything drawn: the ridden road's.
					minEle: route.minEle,
					maxEle: route.maxEle,
					scene: route.scene,
					climbs: [],
				},
				mouths: [first, last],
			});
		}
		// Kept once the whole of it is cut: a road never ends on itself.
		for (const s of sides) keepAll(s.route);
		out.push(...sides);
	}
	return out;
}
