import { ROAD_W } from './terrain/road-profile';

/**
 * A road the route rides twice, drawn once (#4531). A route that leaves and
 * comes back along the same street carries two GPS traces of it a few metres
 * apart, and the world drew both: two ribbons overlapping, grass between
 * them. Where a later pass runs within about a road width of an earlier one,
 * alongside it either way, the later pass is drawn on the earlier: its
 * samples move onto the earlier pass's line and height, easing on and off
 * over BLEND_M. Only where the world draws it: the route's metres and grades
 * are the ride's and stay as recorded, so a rider rides the same distance at
 * the same grade, on the road as drawn. Three-free, a grid over the
 * samples: linear in the route's length.
 */

/** A later pass this near an earlier one, centre to centre, is on it: about a road width. */
export const SHARE_M = ROAD_W;
/** Once on it, it stays on while within this: GPS noise never splits a shared stretch. */
const STAY_M = 1.5 * SHARE_M;
/** Metres along the route two samples lie apart at least to be two passes, not one bend or hairpin. */
const APART_M = 300;
/** Alongside: the two headings within 30° of parallel or of opposite. */
const ALONGSIDE = Math.cos((30 * Math.PI) / 180);
/** Heights further apart than this are two roads, one over the other: a stack of switchbacks, a bridge. */
const RISE_M = 4;
/** A shared stretch is at least this long; a crossing is not one. */
const RUN_M = 60;
/** Metres over which a later pass eases onto the earlier one, and off it again, at a shared stretch's ends. */
export const BLEND_M = 60;

export type SharedRoad = {
	x: Float64Array;
	z: Float64Array;
	ele: Float64Array;
	/** Per sample, how far it is drawn on an earlier pass: 1 on it, 0 its own, between while easing. */
	shared: Float64Array;
};

/**
 * The route's samples drawn once where it rides a road twice, or null where
 * it never does: such a route is drawn exactly as recorded.
 */
export function shareRoad(
	x: ArrayLike<number>,
	z: ArrayLike<number>,
	ele: ArrayLike<number>,
	step: number,
): SharedRoad | null {
	const n = x.length;
	if (n < 3) return null;
	const apart = Math.ceil(APART_M / step);
	// Every segment by the cells its box touches; a cell as wide as the reach, so a sample's 3 × 3 holds every segment within it.
	const cell = STAY_M;
	const key = (i: number, j: number) => i * 73856093 + j * 19349663;
	const grid = new Map<number, number[]>();
	for (let s = 0; s < n - 1; s++) {
		const i0 = Math.floor(Math.min(x[s], x[s + 1]) / cell);
		const i1 = Math.floor(Math.max(x[s], x[s + 1]) / cell);
		const j0 = Math.floor(Math.min(z[s], z[s + 1]) / cell);
		const j1 = Math.floor(Math.max(z[s], z[s + 1]) / cell);
		for (let i = i0; i <= i1; i++)
			for (let j = j0; j <= j1; j++) {
				const k = key(i, j);
				const list = grid.get(k);
				if (list) list.push(s);
				else grid.set(k, [s]);
			}
	}

	// Each sample's nearest point on an earlier pass alongside it, within STAY_M: on a segment of the road's own (never itself on an earlier pass).
	const near = new Float64Array(n).fill(Infinity);
	const tx = new Float64Array(n);
	const tz = new Float64Array(n);
	const te = new Float64Array(n);
	const on = new Uint8Array(n);
	const dir = (s: number) => {
		const dx = x[s + 1] - x[s];
		const dz = z[s + 1] - z[s];
		const len = Math.hypot(dx, dz) || 1;
		return [dx / len, dz / len, len] as const;
	};
	/** Sample `p` on segment `s` of an earlier pass, if it can lie there: how far, and where. */
	function onto(p: number, s: number) {
		if (s + 1 > p - apart || on[s] || on[s + 1]) return null;
		const [hx, hz] = dir(Math.min(p, n - 2));
		const [ux, uz, len] = dir(s);
		if (Math.abs(ux * hx + uz * hz) < ALONGSIDE) return null;
		const t = Math.min(
			1,
			Math.max(0, ((x[p] - x[s]) * ux + (z[p] - z[s]) * uz) / len),
		);
		const qx = x[s] + (x[s + 1] - x[s]) * t;
		const qz = z[s] + (z[s + 1] - z[s]) * t;
		const qe = ele[s] + (ele[s + 1] - ele[s]) * t;
		const d = Math.hypot(x[p] - qx, z[p] - qz);
		if (d > STAY_M || Math.abs(qe - ele[p]) > RISE_M) return null;
		return { d, qx, qz, qe };
	}
	/** Keeps the nearer of sample `p`'s target and its point on segment `s`. */
	function take(p: number, s: number) {
		const q = onto(p, s);
		if (!q || q.d >= near[p]) return;
		near[p] = q.d;
		tx[p] = q.qx;
		tz[p] = q.qz;
		te[p] = q.qe;
	}
	for (let p = apart + 1; p < n; p++) {
		const ci = Math.floor(x[p] / cell);
		const cj = Math.floor(z[p] / cell);
		for (let i = ci - 1; i <= ci + 1; i++)
			for (let j = cj - 1; j <= cj + 1; j++)
				for (const s of grid.get(key(i, j)) ?? []) take(p, s);
		on[p] = near[p] < SHARE_M ? 1 : 0;
	}

	// Stretches: what came within SHARE_M, widened while within STAY_M, kept if RUN_M long.
	const runs: [number, number][] = [];
	for (let p = 0; p < n; p++) {
		if (!on[p]) continue;
		let a = p;
		let b = p;
		while (b + 1 < n && (on[b + 1] || near[b + 1] < STAY_M)) b++;
		while (a > 0 && !on[a - 1] && near[a - 1] < STAY_M) a--;
		if ((b - a) * step >= RUN_M) runs.push([a, b]);
		p = b;
	}
	if (runs.length === 0) return null;

	const out: SharedRoad = {
		x: Float64Array.from(x),
		z: Float64Array.from(z),
		ele: Float64Array.from(ele),
		shared: new Float64Array(n),
	};
	const ease = (f: number) => f * f * (3 - 2 * f);
	const blend = Math.max(1, Math.round(BLEND_M / step));
	// Each stretch eases on over its first BLEND_M and off over its last, within it, where every sample has its point on the earlier pass nearby: no sample is pulled further than STAY_M.
	for (const [a, b] of runs) {
		const ramp = Math.min(blend, Math.floor((b - a) / 2));
		for (let p = a; p <= b; p++) {
			const k = b === n - 1 ? p - a : Math.min(p - a, b - p); // a route that ends on the street ends on it
			const w = k >= ramp ? 1 : ease(k / ramp);
			out.shared[p] = w;
			out.x[p] = x[p] + (tx[p] - x[p]) * w;
			out.z[p] = z[p] + (tz[p] - z[p]) * w;
			out.ele[p] = ele[p] + (te[p] - ele[p]) * w;
		}
	}
	return out;
}

/** How far the road at metre `d` is drawn on an earlier pass: the route's samples' share, in line between them. */
export function sharedAt(
	route: { shared?: Float64Array; length: number; step: number },
	d: number,
): number {
	const s = route.shared;
	if (!s) return 0;
	const L = route.length;
	const dd = d < 0 || d > L ? ((d % L) + L) % L : d;
	const f = Math.min(dd / route.step, s.length - 1);
	const i = Math.min(Math.floor(f), s.length - 2);
	return s[i] + (s[i + 1] - s[i]) * (f - i);
}
