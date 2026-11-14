/**
 * The other roads of a map, as the road ridden meets them (designed.ts): a
 * map's loops share stretches of road, and where another loop leaves the
 * one ridden its road is there to see, a junction and a road going off to
 * the lake or up the pass. Each is a stretch of that loop's own line, from
 * where it leaves this road (or a stretch already kept) to where it comes
 * back: a road with two ends, drawn and built on as the ridden one is,
 * never ridden. Three-free.
 *
 * A side road runs on into the road it meets, to END_M from its centre:
 * the two ribbons overlap, and the road's own paint makes the junction of
 * them, as it does where a route joins itself (crossings.ts JOINS and
 * JOINED): the side road is not drawn inside the other's asphalt, the other
 * gives up its shoulder under it and dashes its edge line across the mouth.
 * Nothing is laid over the two to hide a seam, so there is none to show
 * through.
 */
import type { Route } from '#lib/road/route.ts';
import { ROAD_W } from './terrain/road-profile';

/** A side road is one where its line is this far from every road kept so far: past both formations. */
const CLEAR_M = 11;
/** And it ends this far from the centre of the road it meets: inside that road's asphalt, which hides its end, and near enough its edge line for the line to be dashed the mouth's width (geometry.ts MOUTH_WITHIN_M). */
export const END_M = 2.4;
/** A stretch shorter than this is two roads brushing past one another, not a road. */
const MIN_M = 40;
/** Metres a side road is followed back towards the road it leaves, at the most: one leaving at a shallower angle than that is cut where it is, with a rounded end. */
const REACH_M = 70;
/** Samples over which a side road's end eases to the height of the road it meets. */
const EASE = 12;
/** The most a ribbon runs on past its mouth. */
const OVER_MAX_M = 8;
const CELL_M = 16;

/** Where a side road meets a road: the end of its line, the way across to that road's centre, and that road's height there. */
export type Mouth = {
	x: number;
	z: number;
	/** Unit, from the side road's end to the road met. */
	tx: number;
	tz: number;
	/** Metres from the side road's end to the centre of the road met. */
	d: number;
	/** Unit, the way the side road runs into the junction. */
	sx: number;
	sz: number;
	h: number;
	/** The road met: 0 the road ridden, k the side road k − 1; and the metre along it the mouth lies at. */
	met: number;
	at: number;
	/** Every road drawn before this one that passes the mouth, the one met among them (world.ts fills it). */
	near?: { road: number; at: number }[];
	/** Metres its ribbon runs on past the mouth, so a road that comes in askew is under the other's asphalt across its whole width, not cut square short of it. */
	over: number;
};
export type SideRoad = {
	route: Route;
	/** Its first end's mouth and its last's; null where it ends in the open, a lane's far end. */
	mouths: [Mouth | null, Mouth | null];
	/** Its ends are cut square, not rounded: a roundabout's arm, which a road runs on from. */
	square?: boolean;
};

/** Metres from (x, z) to a road's line within `reach` metres either side of its metre `at`: a junction's own stretch of it. */
export function offRoad(
	r: Route,
	at: number,
	x: number,
	z: number,
	reach = 40,
): number {
	const a = Math.max(0, Math.floor((at - reach) / r.step));
	const b = Math.min(r.x.length - 2, Math.ceil((at + reach) / r.step));
	let best = Infinity;
	for (let i = a; i <= b; i++) {
		const sx = r.x[i + 1] - r.x[i];
		const sz = r.z[i + 1] - r.z[i];
		const px = x - r.x[i];
		const pz = z - r.z[i];
		const t = Math.min(
			1,
			Math.max(0, (px * sx + pz * sz) / (sx * sx + sz * sz || 1)),
		);
		best = Math.min(best, Math.hypot(px - sx * t, pz - sz * t));
	}
	return best;
}

export function sideRoads(
	route: Route,
	others: readonly Route[],
	/** Roads kept whole, before the others: a roundabout's ring, which the road ridden runs on and is hidden under (world.ts). */
	whole: readonly Route[] = [],
): SideRoad[] {
	const kept = new Map<string, number[]>();
	const keep = (x: number, z: number, h: number, owner: number, m: number) => {
		const k = `${Math.floor(x / CELL_M)}:${Math.floor(z / CELL_M)}`;
		const cell = kept.get(k);
		if (cell) cell.push(x, z, h, owner, m);
		else kept.set(k, [x, z, h, owner, m]);
	};
	/** The kept point nearest (x, z) within CLEAR_M: how far, where, and its height. */
	const nearest = (x: number, z: number) => {
		const ci = Math.floor(x / CELL_M);
		const cj = Math.floor(z / CELL_M);
		let best = CLEAR_M;
		let hit: {
			d: number;
			x: number;
			z: number;
			h: number;
			owner: number;
			m: number;
		} | null = null;
		for (let i = ci - 1; i <= ci + 1; i++)
			for (let j = cj - 1; j <= cj + 1; j++) {
				const cell = kept.get(`${i}:${j}`);
				if (!cell) continue;
				for (let k = 0; k < cell.length; k += 5) {
					const d = Math.hypot(cell[k] - x, cell[k + 1] - z);
					if (d < best) {
						best = d;
						hit = {
							d,
							x: cell[k],
							z: cell[k + 1],
							h: cell[k + 2],
							owner: cell[k + 3],
							m: cell[k + 4],
						};
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
	/** A line's points every half metre, kept as road `owner`'s. */
	const keepAll = (r: Route, owner: number) => {
		const end = (r.x.length - 1) * r.step;
		for (let m = 0; m <= end; m += 0.5) {
			const p = at(r, m);
			keep(p.x, p.z, p.ele, owner, m);
		}
	};
	keepAll(route, 0);
	const out: SideRoad[] = [];
	for (const w of whole) {
		out.push({
			route: {
				...w,
				minEle: route.minEle,
				maxEle: route.maxEle,
				scene: route.scene,
			},
			mouths: [null, null],
			square: true,
		});
		keepAll(w, out.length);
	}
	for (const given of others) {
		// A road that goes round starts wherever it was drawn from: turned to start on a road kept already, so no stretch of it is cut in two at its own start.
		let other = given;
		let on = -1;
		if (given.loop) {
			// Where it lies nearest one: on it, if it runs along one anywhere.
			let best = CLEAR_M;
			for (let i = 0; i < given.x.length - 1; i++) {
				const hit = nearest(given.x[i], given.z[i]);
				if (hit && hit.d < best) {
					best = hit.d;
					on = i;
				}
			}
		}
		if (on > 0) {
			const turn = <T extends Float64Array>(v: T) =>
				Float64Array.from([...v.slice(on, -1), ...v.slice(0, on + 1)]);
			other = {
				...given,
				x: turn(given.x),
				z: turn(given.z),
				ele: turn(given.ele),
				grade: turn(given.grade),
			};
		}
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
				for (let by = 0; by <= REACH_M; by += 0.25) {
					const at0 = m + dir * by;
					if (at0 < 0 || at0 > end)
						return [Math.min(Math.max(at0, 0), end), null];
					const p = at(other, at0);
					const hit = nearest(p.x, p.z);
					if (hit && hit.d <= END_M) {
						const d = hit.d || 1;
						const q = at(other, at0 - dir * 2);
						const run = Math.hypot(p.x - q.x, p.z - q.z) || 1;
						const sx = (p.x - q.x) / run;
						const sz = (p.z - q.z) / run;
						const square = Math.abs(
							(sx * (hit.x - p.x) + sz * (hit.z - p.z)) / d,
						);
						const skew = Math.sqrt(Math.max(0, 1 - square * square));
						const want = Math.min(
							OVER_MAX_M,
							((ROAD_W / 2) * skew) / Math.max(square, 0.2),
						);
						const over = Math.max(0, Math.min(want, dir > 0 ? end - at0 : at0));
						return [
							at0 + dir * over,
							{
								x: p.x,
								z: p.z,
								tx: (hit.x - p.x) / d,
								tz: (hit.z - p.z) / d,
								d: hit.d,
								sx,
								sz,
								over,
								h: hit.h,
								met: hit.owner,
								at: hit.m,
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
		for (const s of sides) {
			out.push(s);
			keepAll(s.route, out.length);
		}
	}
	return out;
}
