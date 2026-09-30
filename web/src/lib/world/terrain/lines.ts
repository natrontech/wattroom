import { smoothstep } from '../rand';

/**
 * The roads the ground is shaped by (#3075): every line through a place, not
 * only the one ridden (ADR-0081). A line is a road's centreline in the local
 * frame with its surface height at each vertex. One index over all of them
 * answers what the ground asks: the nearest point of any road, every vertex
 * within a reach, and the smooth heights the natural ground leans on.
 */
export type Line = {
	/** Names the road's data, so lines sort the same whoever lists them. */
	key: string;
	x: ArrayLike<number>;
	z: ArrayLike<number>;
	h: ArrayLike<number>;
};

export type Hit = {
	d: number;
	/** The vertex that starts the nearest segment, in the index's own numbering. */
	i: number;
	t: number;
	h: number;
	/** +1 left of travel, −1 right. */
	side: number;
};

/**
 * Lines in one order and each in one direction, whoever lists them and
 * whichever way they ride them: every sum the ground takes then adds in the
 * same order, and two routes over one place agree to the bit.
 * ponytail: a closed line keeps the direction it came in; a stroke never closes (ADR-0082).
 */
export function canonical(lines: readonly Line[]): Line[] {
	return [...lines]
		.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
		.map((l) => {
			const n = l.x.length - 1;
			const forward =
				l.x[0] < l.x[n] || (l.x[0] === l.x[n] && l.z[0] <= l.z[n]);
			if (forward) return l;
			const back = (a: ArrayLike<number>) => Float64Array.from(a).reverse();
			return { key: l.key, x: back(l.x), z: back(l.z), h: back(l.h) };
		});
}

const CELL = 40;
const WIDE = 200;
/** Metres a road's height still pulls the ground towards it. */
export const REACH = 600;
/** How hard the far field pulls against the road-weighted height. */
export const FAR_W = 1 / (REACH * REACH);
/** Past this the index answers distance from vertices ~20 m apart, which is within 0.2 m. */
const EXACT_M = 6 * CELL;

/** Every `gap` metres of arc along each line, from its first vertex: indices into the flat arrays. */
function thin(starts: number[], x: Float64Array, z: Float64Array, gap: number) {
	const out: number[] = [];
	for (let l = 0; l < starts.length - 1; l++) {
		let since = gap;
		for (let g = starts[l]; g < starts[l + 1]; g++) {
			if (g > starts[l])
				since += Math.sqrt((x[g] - x[g - 1]) ** 2 + (z[g] - z[g - 1]) ** 2);
			if (since < gap) continue;
			out.push(g);
			since = 0;
		}
	}
	return out;
}

export function indexLines(lines: readonly Line[]) {
	const starts = [0];
	for (const l of lines) starts.push(starts.at(-1)! + l.x.length);
	const N = starts.at(-1)!;
	const x = new Float64Array(N);
	const z = new Float64Array(N);
	const h = new Float64Array(N);
	const last = new Uint8Array(N); // the last vertex of its line starts no segment
	const lineOf = new Int32Array(N);
	lines.forEach((l, k) => {
		for (let i = 0; i < l.x.length; i++) {
			x[starts[k] + i] = l.x[i];
			z[starts[k] + i] = l.z[i];
			h[starts[k] + i] = l.h[i];
			lineOf[starts[k] + i] = k;
		}
		last[starts[k + 1] - 1] = 1;
	});
	// A small integer, so the maps hash it fast. ponytail: cells wrap at 32,768 a side — 1,300 km of 40 m cells.
	const key = (i: number, j: number) => ((i & 0x7fff) << 15) | (j & 0x7fff);
	/** The cells on the square ring `r` around (ci, cj). */
	const ring = (ci: number, cj: number, r: number, fn: (k: number) => void) => {
		if (r === 0) return fn(key(ci, cj));
		for (let d = -r; d <= r; d++) {
			fn(key(ci + d, cj - r));
			fn(key(ci + d, cj + r));
		}
		for (let d = 1 - r; d < r; d++) {
			fn(key(ci - r, cj + d));
			fn(key(ci + r, cj + d));
		}
	};
	const bucket = (m: Map<number, number[]>, size: number, g: number) => {
		const k = key(Math.floor(x[g] / size), Math.floor(z[g] / size));
		const b = m.get(k);
		if (b) b.push(g);
		else m.set(k, [g]);
	};
	const near = new Map<number, number[]>();
	for (let g = 0; g < N; g++) bucket(near, CELL, g);
	const wide = new Map<number, number[]>();
	for (const g of thin(starts, x, z, 20)) bucket(wide, WIDE, g);
	const far = thin(starts, x, z, 200);

	/** The nearest point of any segment within `rings` cells of (px, pz), on any line but `skip`; null past them. */
	function nearest(px: number, pz: number, rings = 6, skip = -1): Hit | null {
		const ci = Math.floor(px / CELL);
		const cj = Math.floor(pz / CELL);
		let best = Infinity;
		let bi = -1;
		let bt = 0;
		const segment = (a: number) => {
			if (a < 0 || last[a] || lineOf[a] === skip) return;
			const sx = x[a + 1] - x[a];
			const sz = z[a + 1] - z[a];
			const len2 = sx * sx + sz * sz || 1;
			const t = Math.min(
				1,
				Math.max(0, ((px - x[a]) * sx + (pz - z[a]) * sz) / len2),
			);
			const ex = x[a] + sx * t - px;
			const ez = z[a] + sz * t - pz;
			const d2 = ex * ex + ez * ez;
			if (d2 < best || (d2 === best && a < bi)) {
				best = d2;
				bi = a;
				bt = t;
			}
		};
		const visit = (k: number) => {
			const b = near.get(k);
			// A vertex stands for the segment it starts and the one it ends.
			if (b) for (const g of b) (segment(g - 1), segment(g));
		};
		for (
			let r = 0;
			r <= rings && !(bi >= 0 && Math.sqrt(best) <= (r - 1) * CELL);
			r++
		)
			ring(ci, cj, r, visit);
		if (bi < 0) return null;
		const sx = x[bi + 1] - x[bi];
		const sz = z[bi + 1] - z[bi];
		// Left of travel is (sz, −sx) in an x-east, z-south plane.
		const side = Math.sign(sz * (px - x[bi]) - sx * (pz - z[bi])) || 1;
		return {
			d: Math.sqrt(best),
			i: bi,
			t: bt,
			h: h[bi] + (h[bi + 1] - h[bi]) * bt,
			side,
		};
	}

	/** Every vertex within `reach` metres: `fn(height, distance)`. */
	function within(
		px: number,
		pz: number,
		reach: number,
		fn: (vh: number, d: number) => void,
	) {
		const ci = Math.floor(px / CELL);
		const cj = Math.floor(pz / CELL);
		const R = Math.ceil(reach / CELL);
		for (let dj = -R; dj <= R; dj++)
			for (let di = -R; di <= R; di++)
				for (const g of near.get(key(ci + di, cj + dj)) ?? []) {
					const d2 = (x[g] - px) ** 2 + (z[g] - pz) ** 2;
					if (d2 < reach * reach) fn(h[g], Math.sqrt(d2));
				}
	}

	/** Every vertex ~20 m apart within `reach` metres: `fn(height, distance)`. */
	function thinWithin(
		px: number,
		pz: number,
		reach: number,
		fn: (vh: number, d: number) => void,
	) {
		const ci = Math.floor(px / WIDE);
		const cj = Math.floor(pz / WIDE);
		const R = Math.ceil(reach / WIDE);
		for (let dj = -R; dj <= R; dj++)
			for (let di = -R; di <= R; di++)
				for (const g of wide.get(key(ci + di, cj + dj)) ?? []) {
					const ex = x[g] - px;
					const ez = z[g] - pz;
					const d2 = ex * ex + ez * ez;
					if (d2 < reach * reach) fn(h[g], Math.sqrt(d2));
				}
	}

	/**
	 * The nearest road within `cap` metres, its distance and its height:
	 * exact near it, from vertices ~20 m apart beyond, which is within 0.2 m.
	 */
	function closest(
		px: number,
		pz: number,
		cap: number,
	): { d: number; h: number } | null {
		const ci = Math.floor(px / WIDE);
		const cj = Math.floor(pz / WIDE);
		const rings = Math.ceil(cap / WIDE);
		let best = Infinity;
		let bh = 0;
		const visit = (k: number) => {
			for (const g of wide.get(k) ?? []) {
				const ex = x[g] - px;
				const ez = z[g] - pz;
				const d2 = ex * ex + ez * ez;
				if (d2 < best) {
					best = d2;
					bh = h[g];
				}
			}
		};
		for (let r = 0; r <= rings && !(Math.sqrt(best) <= (r - 1) * WIDE); r++)
			ring(ci, cj, r, visit);
		const approx = Math.sqrt(best);
		if (approx > cap) return null;
		// Vertices 20 m apart put the true distance within 10 m below this.
		if (approx <= EXACT_M + 10) {
			const hit = nearest(px, pz, Math.ceil((approx + CELL) / CELL));
			if (hit) return hit;
		}
		return { d: approx, h: bh };
	}

	/**
	 * Shepard-weighted road height: every sample within REACH pulls, the
	 * closest hardest. A sum of smooth terms is smooth — no seam where the
	 * nearest road switches from one switchback to the next.
	 */
	function weighted(px: number, pz: number): { h: number; weight: number } {
		const ci = Math.floor(px / WIDE);
		const cj = Math.floor(pz / WIDE);
		const R = Math.ceil(REACH / WIDE);
		let se = 0;
		let sw = 0;
		for (let dj = -R; dj <= R; dj++)
			for (let di = -R; di <= R; di++)
				for (const g of wide.get(key(ci + di, cj + dj)) ?? []) {
					const d2 = (x[g] - px) ** 2 + (z[g] - pz) ** 2;
					if (d2 >= REACH * REACH) continue;
					const w =
						(1 / (d2 + 36)) *
						(1 - smoothstep(REACH * 0.3, REACH, Math.sqrt(d2)));
					se += h[g] * w;
					sw += w;
				}
		return { h: sw > 0 ? se / sw : 0, weight: sw };
	}

	/**
	 * The far field: every 200 m of every road pulls every point, 1/d⁴ with a
	 * 300 m core — one smooth surface, so a valley road and a summit road
	 * 2 km apart meet in a hillside, not in a seam.
	 */
	function farField(px: number, pz: number): number {
		let se = 0;
		let sw = 0;
		for (const g of far) {
			const q = (x[g] - px) ** 2 + (z[g] - pz) ** 2 + 300 * 300;
			const w = 1 / (q * q);
			se += h[g] * w;
			sw += w;
		}
		return sw > 0 ? se / sw : 0;
	}

	let lo = Infinity;
	let hi = -Infinity;
	for (let g = 0; g < N; g++) {
		lo = Math.min(lo, h[g]);
		hi = Math.max(hi, h[g]);
	}

	return {
		nearest,
		within,
		thinWithin,
		closest,
		weighted,
		farField,
		lo,
		hi,
		starts,
		lineOf,
		x,
		z,
		h,
		last,
	};
}

export type LineIndex = ReturnType<typeof indexLines>;
