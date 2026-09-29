// The ground as one function: height at any (x, z), from the road outward.
// Every consumer — the fine terrain beside the road, the coarse terrain far
// away, props, the camera's floor — asks this function, so nothing floats
// and nothing sinks through the road.
import { type Route } from '$lib/road/route';
import { curvature } from '$lib/road/along';
import { fbm, noise2, smoothstep } from './rand';

export type RoadHit = {
	d: number;
	i: number;
	t: number;
	ele: number;
	side: number;
};
export type Nearest = (
	x: number,
	z: number,
	maxRing?: number,
) => RoadHit | null;
type Near = (x: number, z: number, reach: number, out: number[]) => number[];

const REACH = 600; // metres a road sample still pulls the ground towards its height
const WIDE = 200; // coarser buckets for the long-reach weighted height

// Nearest point on the road polyline (segment projection) and a smooth
// weighted road height, both through one spatial hash.
export function roadIndex(route: Route, cell = 80) {
	const wide = new Map<number, number[]>();
	const buckets = new Map<number, number[]>();
	const key = (ix: number, iz: number) => (ix + 32768) * 65536 + (iz + 32768);
	const push = (m: Map<number, number[]>, k: number, i: number) => {
		const b = m.get(k);
		if (b) b.push(i);
		else m.set(k, [i]);
	};
	for (let i = 0; i < route.x.length - 1; i++) {
		const x = route.x[i];
		const z = route.z[i];
		push(buckets, key(Math.floor(x / cell), Math.floor(z / cell)), i);
		// every 20 m is plenty for a smooth average
		if (i % 2 === 0)
			push(wide, key(Math.floor(x / WIDE), Math.floor(z / WIDE)), i);
	}
	const nearest: Nearest = (x, z, maxRing = 6) => {
		const cx = Math.floor(x / cell);
		const cz = Math.floor(z / cell);
		let best = Infinity;
		let bi = -1;
		let bt = 0;
		for (let r = 0; r <= maxRing; r++) {
			for (let dz = -r; dz <= r; dz++)
				for (let dx = -r; dx <= r; dx++) {
					if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
					const b = buckets.get(key(cx + dx, cz + dz));
					if (!b) continue;
					for (const i of b) {
						const ax = route.x[i];
						const az = route.z[i];
						const sx = route.x[i + 1] - ax;
						const sz = route.z[i + 1] - az;
						const len2 = sx * sx + sz * sz || 1;
						const t = Math.min(
							1,
							Math.max(0, ((x - ax) * sx + (z - az) * sz) / len2),
						);
						const d2 = (ax + sx * t - x) ** 2 + (az + sz * t - z) ** 2;
						if (d2 < best) {
							best = d2;
							bi = i;
							bt = t;
						}
					}
				}
			if (bi >= 0 && Math.sqrt(best) <= r * cell) break;
		}
		if (bi < 0) return null;
		const sx = route.x[bi + 1] - route.x[bi];
		const sz = route.z[bi + 1] - route.z[bi];
		// left of travel is (sz, −sx) in three's x-east/z-south plane; +1 = left, the inside of a left bend
		const side =
			Math.sign(sz * (x - route.x[bi]) - sx * (z - route.z[bi])) || 1;
		return {
			d: Math.sqrt(best),
			i: bi,
			t: bt,
			ele: route.ele[bi] + (route.ele[bi + 1] - route.ele[bi]) * bt,
			side,
		};
	};
	// Shepard-weighted road height: every sample within REACH pulls, the
	// closest hardest. A sum of smooth terms is smooth — no seam where the
	// nearest road switches from one switchback to the next.
	function weighted(x: number, z: number): { ele: number; weight: number } {
		const cx = Math.floor(x / WIDE);
		const cz = Math.floor(z / WIDE);
		const R = Math.ceil(REACH / WIDE);
		let se = 0;
		let sw = 0;
		for (let dz = -R; dz <= R; dz++)
			for (let dx = -R; dx <= R; dx++) {
				const b = wide.get(key(cx + dx, cz + dz));
				if (!b) continue;
				for (const i of b) {
					const d2 = (route.x[i] - x) ** 2 + (route.z[i] - z) ** 2;
					if (d2 >= REACH * REACH) continue;
					const w =
						(1 / (d2 + 36)) *
						(1 - smoothstep(REACH * 0.3, REACH, Math.sqrt(d2)));
					se += route.ele[i] * w;
					sw += w;
				}
			}
		return { ele: sw > 0 ? se / sw : 0, weight: sw };
	}
	// Every sample within `reach` metres: (index, distance²) pairs — the cut/fill
	// cones of every stretch nearby, not only the nearest.
	const near: Near = (x, z, reach, out) => {
		out.length = 0;
		const cx = Math.floor(x / cell);
		const cz = Math.floor(z / cell);
		const R = Math.ceil(reach / cell);
		for (let dz = -R; dz <= R; dz++)
			for (let dx = -R; dx <= R; dx++) {
				const b = buckets.get(key(cx + dx, cz + dz));
				if (!b) continue;
				for (const i of b) {
					const d2 = (route.x[i] - x) ** 2 + (route.z[i] - z) ** 2;
					if (d2 < reach * reach) out.push(i, d2);
				}
			}
		return out;
	};
	return { nearest, weighted, near };
}

export type Field = ReturnType<typeof makeField>;
export const FAR_W = 1 / (REACH * REACH); // how hard the far field pulls against the road-weighted height

// `baseAt` is the smooth ground the road sits in (see world.ts): the road's
// own height near it, a weighted blend between stretches, the far field beyond.
export const FORMATION = 4.8; // edge of the shoulder: where the road's own earthwork ends
const BENCH = 7; // flat verge before a cutting starts — keeps a 10 m mesh off the asphalt
const CUT = 1.0; // 1:1 cut slope
const FILL = 0.667; // 1.5:1 fill slope
export const SUBGRADE = 0.45; // ground under the road sits this far below the surface

export function makeField(
	route: Route,
	seed: number,
	baseAt: (x: number, z: number) => number,
	near: Near,
) {
	const scratch: number[] = [];
	const nBig = noise2(seed ^ 0x9e3779b9);
	const nDetail = noise2(seed ^ 0x85ebca6b);
	const nSide = noise2(seed ^ 0xc2b2ae35);
	const span = Math.max(200, route.maxEle - route.minEle);

	const smin = (a: number, b: number, k: number) => {
		const h = Math.max(k - Math.abs(a - b), 0) / k;
		return Math.min(a, b) - (h * h * k) / 4;
	};
	const smoothClamp = (v: number, lo: number, hi: number, k: number) =>
		-smin(-smin(v, hi, k), -lo, k);

	// The ground rises or falls away from the road; the road sits on a shelf cut into it.
	function height(x: number, z: number, d: number, roadEle: number): number {
		const base = baseAt(x, z);
		const side = nSide(x / 2600, z / 2600);
		const rise =
			Math.min(d, 1600) *
			(0.1 + 0.16 * side) *
			(0.6 + (base - route.minEle) / span) *
			smoothstep(30, 300, d);
		const rugged = 40 + 0.08 * Math.max(0, base - 500);
		const hills =
			fbm(nBig, x / 1100, z / 1100, 3) * rugged * 2.2 * smoothstep(60, 700, d);
		const detail =
			fbm(nDetail, x / 160, z / 160, 3) * 7 * smoothstep(15, 120, d);
		const natural = base + rise + hills + detail;
		if (d <= FORMATION) return roadEle - SUBGRADE;
		// Real earthworks: the ground may rise from the road no steeper than a
		// 1:1 cutting (after a flat verge) and fall away no steeper than a 1.5:1
		// embankment — from every stretch within 60 m, so stacked switchbacks
		// share one slope and a hairpin's inside is one bank.
		let lower = roadEle - SUBGRADE - FILL * (d - FORMATION);
		let upper = roadEle - SUBGRADE + CUT * Math.max(0, d - FORMATION - BENCH);
		const list = near(x, z, 60, scratch);
		for (let k = 0; k < list.length; k += 2) {
			const i = list[k];
			const dd = Math.max(0, Math.sqrt(list[k + 1]) - FORMATION);
			const y = route.ele[i] - SUBGRADE;
			lower = Math.max(lower, y - FILL * dd);
			upper = Math.min(upper, y + CUT * Math.max(0, dd - BENCH));
		}
		if (lower > upper) return (lower + upper) / 2; // two stretches disagree: a retaining wall's worth, split
		return smoothClamp(natural, lower, upper, 1.5);
	}

	// How much room a thing needs from the road at sample i on `side`: more on
	// the inside of a bend, where the camera's sightline cuts the corner.
	function clearance(i: number, side: number, base: number): number {
		const k = curvature(route, Math.min(route.x.length - 1, Math.max(0, i)));
		if (Math.sign(k) !== side || Math.abs(k) < 1 / 400) return base;
		const r = 1 / Math.abs(k);
		const half = 18; // half the chord from the chase camera (~8 m behind) to its gaze (~18 m ahead)
		const sag = r <= half ? r : r - Math.sqrt(r * r - half * half);
		return base + sag + 4;
	}

	return { height, clearance, noise: { nDetail } };
}

// Is (x, z) at least `base` metres (more inside a bend) from the road?
export function clearOf(
	field: Field,
	nearest: Nearest,
	x: number,
	z: number,
	base: number,
): boolean {
	const hit = nearest(x, z, 2);
	if (!hit) return true; // farther than two hash rings (~200 m): nothing to block
	return hit.d >= field.clearance(hit.i, hit.side, base);
}
