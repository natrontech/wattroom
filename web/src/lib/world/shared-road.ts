import { ROAD_W } from './terrain/road-profile';

/**
 * A road the route rides twice, drawn once (#4531). A route that leaves and
 * comes back along the same street carries two GPS traces of it, and the
 * world drew both: two ribbons braided, grass between them. Where a later
 * pass runs alongside an earlier one, either way, the later pass is drawn on
 * the earlier: its samples move onto the earlier pass's line and height,
 * easing on and off. Only where the world draws it: the route's metres and
 * grades are the ride's and stay as recorded, so a rider rides the same
 * distance at the same grade, on the road as drawn. Three-free, a grid over
 * the samples: linear in the route's length.
 *
 * Two traces of one street lie a few metres apart, and for hundreds of
 * metres as much as 15 m, but they run parallel: a rider's own street, ridden
 * out and back, measured 4–10 m apart over a kilometre, 14.5–15.6 m over
 * 300 m, its headings within 6° (p90) and its heights within 3 m. The
 * next street over lies a building's depth away, 30 m and more.
 */

/** A later pass this near an earlier one, centre to centre, is on it: about a road width. */
export const SHARE_M = ROAD_W;
/**
 * Further off, up to three road widths, a later pass is on an earlier one
 * where it runs parallel to it, and once on it stays on while within this:
 * GPS noise never splits a shared stretch. A road further off is another road.
 */
export const WIDE_M = 3 * ROAD_W;
/** Parallel: the two headings within 10° of each other, either way. Two traces of one street measured 6° at p90; a road that crosses or forks off does not hold it. */
const PARALLEL = Math.cos((10 * Math.PI) / 180);
/** A jog this long, where one trace crosses the other steeper than alongside, does not split a shared stretch: the rider's street measured 20 m at up to 39°. */
const GAP_M = 30;
/** Metres along the route two samples lie apart at least to be two passes, not one bend or hairpin. */
const APART_M = 300;
/** Alongside: the two headings within 30° of parallel or of opposite. */
const ALONGSIDE = Math.cos((30 * Math.PI) / 180);
/** Heights further apart than this are two roads, one over the other: a stack of switchbacks, a bridge. */
const RISE_M = 4;
/** A shared stretch is on an earlier pass for at least this long; a crossing is not one. */
const RUN_M = 60;
/** Metres over which a later pass eases onto the earlier one, and off it again, at the least. */
export const BLEND_M = 60;
/** And metres of easing per metre it moves: a pass 15 m off eases on over 90 m, at most 14° off its own line, as a road joins another. */
const EASE_PER_M = 6;

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
	const cell = WIDE_M;
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

	// Each sample's nearest point on an earlier pass alongside it, within WIDE_M: on a segment of the road's own (never itself on an earlier pass).
	const near = new Float64Array(n).fill(Infinity);
	const level = new Float64Array(n); // |cos| of the angle between the sample's heading and its nearest point's
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
		const cos = Math.abs(ux * hx + uz * hz);
		if (cos < ALONGSIDE) return null;
		const t = Math.min(
			1,
			Math.max(0, ((x[p] - x[s]) * ux + (z[p] - z[s]) * uz) / len),
		);
		const qx = x[s] + (x[s + 1] - x[s]) * t;
		const qz = z[s] + (z[s + 1] - z[s]) * t;
		const qe = ele[s] + (ele[s + 1] - ele[s]) * t;
		const d = Math.hypot(x[p] - qx, z[p] - qz);
		if (d > WIDE_M || Math.abs(qe - ele[p]) > RISE_M) return null;
		return { d, qx, qz, qe, cos };
	}
	/** Keeps the nearer of sample `p`'s target and its point on segment `s`. */
	function take(p: number, s: number) {
		const q = onto(p, s);
		if (!q || q.d >= near[p]) return;
		near[p] = q.d;
		level[p] = q.cos;
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
		on[p] =
			near[p] < SHARE_M || (near[p] < WIDE_M && level[p] >= PARALLEL) ? 1 : 0;
	}
	// A trace that jogs across the other for a sample or two, steeper than alongside, is still on it: its points there lie in line between the jog's ends.
	const gap = Math.floor(GAP_M / step);
	for (let p = apart + 2; p < n - 1; p++) {
		if (near[p] < WIDE_M || near[p - 1] >= WIDE_M) continue;
		let q = p;
		while (q + 1 < n && near[q + 1] >= WIDE_M && q - p + 1 < gap) q++;
		const a = p - 1;
		const b = q + 1;
		if (b >= n || near[b] >= WIDE_M) {
			p = q;
			continue;
		}
		// The jog's ends on the earlier pass are a jog's length apart, not two places on it.
		const span = Math.hypot(tx[b] - tx[a], tz[b] - tz[a]);
		if (span <= 1.5 * (b - a) * step)
			for (let k = p; k <= q; k++) {
				const f = (k - a) / (b - a);
				const kx = tx[a] + (tx[b] - tx[a]) * f;
				const kz = tz[a] + (tz[b] - tz[a]) * f;
				const d = Math.hypot(x[k] - kx, z[k] - kz);
				if (d >= WIDE_M) continue;
				near[k] = d;
				tx[k] = kx;
				tz[k] = kz;
				te[k] = te[a] + (te[b] - te[a]) * f;
			}
		p = q;
	}

	// Stretches: what came on, widened while within WIDE_M, kept if on for RUN_M.
	const runs: [number, number][] = [];
	for (let p = 0; p < n; p++) {
		if (!on[p]) continue;
		let a = p;
		let b = p;
		let seeds = 1;
		while (b + 1 < n && near[b + 1] < WIDE_M) seeds += on[++b];
		while (a > 0 && near[a - 1] < WIDE_M) seeds += on[--a];
		if (seeds * step >= RUN_M) runs.push([a, b]);
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
	/** Samples to ease over from end `e` inward (dir ±1), at most `most`: the more the pass moves there, the longer. */
	function rampOf(e: number, dir: number, most: number) {
		let ramp = Math.min(blend, most);
		for (let i = 0; i < 3; i++) {
			let far = 0;
			for (let k = 0; k <= ramp; k++) far = Math.max(far, near[e + dir * k]);
			ramp = Math.min(
				most,
				Math.max(blend, Math.ceil((EASE_PER_M * far) / step)),
			);
		}
		return Math.max(1, ramp);
	}
	// Each stretch eases on at its start and off at its end, within it, where every sample has its point on the earlier pass nearby: no sample is pulled further than WIDE_M.
	for (const [a, b] of runs) {
		const most = Math.floor((b - a) / 2);
		const easeOn = rampOf(a, 1, most);
		const easeOff = rampOf(b, -1, most);
		for (let p = a; p <= b; p++) {
			// A route that ends on the street ends on it.
			const f = Math.min(
				(p - a) / easeOn,
				b === n - 1 ? Infinity : (b - p) / easeOff,
			);
			const w = f >= 1 ? 1 : ease(f);
			out.shared[p] = w;
			out.x[p] = x[p] + (tx[p] - x[p]) * w;
			out.z[p] = z[p] + (tz[p] - z[p]) * w;
			// Its height leads, on the earlier pass's by half way, before the two ribbons overlap: a pass a metre or more below would show the earlier one's shoulder across its asphalt (#4531).
			const h = f >= 0.5 ? 1 : ease(2 * f);
			out.ele[p] = ele[p] + (te[p] - ele[p]) * h;
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
