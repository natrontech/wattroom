import type { Line, LineIndex } from './lines';

/**
 * Each vertex's curvature, per metre and +left: the heading's turn across at
 * least 6 m and one segment either side of it — long enough that a track's
 * leftover wiggle does not rock the bank. The drawn ribbon banks by it and
 * road furniture stands on that bank (geometry.ts, ground.ts).
 */
export function bendsOf(
	x: ArrayLike<number>,
	z: ArrayLike<number>,
): Float64Array {
	const n = x.length;
	const out = new Float64Array(n);
	if (n < 3) return out;
	const heading = (s: number) => Math.atan2(x[s + 1] - x[s], z[s + 1] - z[s]);
	const arc = new Float64Array(n);
	for (let g = 1; g < n; g++)
		arc[g] =
			arc[g - 1] + Math.sqrt((x[g] - x[g - 1]) ** 2 + (z[g] - z[g - 1]) ** 2);
	const hi = n - 2; // the last segment
	for (let g = 0; g < n; g++) {
		let p = Math.max(0, Math.min(g - 1, hi));
		while (p > 0 && arc[p] > arc[g] - 6) p--;
		let q = Math.min(g, hi);
		while (q < hi && arc[q + 1] < arc[g] + 6) q++;
		if (p === q) continue;
		let turn = heading(q) - heading(p);
		if (turn > Math.PI) turn -= 2 * Math.PI;
		if (turn <= -Math.PI) turn += 2 * Math.PI;
		out[g] = turn / ((arc[q] + arc[q + 1] - arc[p] - arc[p + 1]) / 2);
	}
	return out;
}

/**
 * The road as the ribbon is drawn across it (#3075): where a point lies
 * along a line and how far left of its centre, and how the road bends there.
 */
export function roadFrame(index: LineIndex, lines: readonly Line[]) {
	const { x, z, h, last, nearest, starts } = index;
	const bend = new Float64Array(x.length);
	lines.forEach((l, k) => bend.set(bendsOf(l.x, l.z), starts[k]));

	/**
	 * Where (px, pz) lies across the road as the ribbon is drawn: rows stand
	 * along normals blended from vertex to vertex, so a point's place along
	 * the road never jumps on the inside of a bend, as a nearest point does
	 * where two segments' projections part. `u` is metres left of the centre.
	 */
	function offset(
		px: number,
		pz: number,
		rings = 1,
	): { i: number; t: number; u: number; h: number } | null {
		const hit = nearest(px, pz, rings);
		if (!hit) return null;
		// A vertex's normal: the left normals of the segments meeting there, averaged.
		const normal = (g: number): [number, number] => {
			let nx = 0;
			let nz = 0;
			for (const s of [g - 1, g]) {
				if (s < 0 || last[s]) continue;
				const sx = x[s + 1] - x[s];
				const sz = z[s + 1] - z[s];
				const len = Math.sqrt(sx * sx + sz * sz) || 1;
				nx += sz / len;
				nz -= sx / len;
			}
			const len = Math.sqrt(nx * nx + nz * nz) || 1;
			return [nx / len, nz / len];
		};
		let a = hit.i;
		for (let tries = 0; tries < 3; tries++) {
			const [ax, az] = [x[a], z[a]];
			const [dx, dz] = [x[a + 1] - ax, z[a + 1] - az];
			const [nax, naz] = normal(a);
			const [nbx, nbz] = normal(a + 1);
			const [ex, ez] = [nbx - nax, nbz - naz];
			const [qx, qz] = [px - ax, pz - az];
			const cross = (ux: number, uz: number, vx: number, vz: number) =>
				ux * vz - uz * vx;
			// (Q − tD) × (Na + tE) = 0: the t whose blended normal passes through the point.
			const c0 = cross(qx, qz, nax, naz);
			const c1 = cross(qx, qz, ex, ez) - cross(dx, dz, nax, naz);
			const c2 = -cross(dx, dz, ex, ez);
			let t: number;
			if (Math.abs(c2) < 1e-12) t = -c0 / c1;
			else {
				const disc = Math.sqrt(Math.max(0, c1 * c1 - 4 * c2 * c0));
				const r1 = (-c1 + disc) / (2 * c2);
				const r2 = (-c1 - disc) / (2 * c2);
				t = Math.abs(r1 - hit.t) < Math.abs(r2 - hit.t) ? r1 : r2;
			}
			if (t < 0 && a > 0 && !last[a - 1]) {
				a--;
				continue;
			}
			if (t > 1 && !last[a + 1]) {
				a++;
				continue;
			}
			t = Math.min(1, Math.max(0, t));
			const nx = nax + ex * t;
			const nz = naz + ez * t;
			const len = Math.sqrt(nx * nx + nz * nz) || 1;
			const u = ((qx - dx * t) * nx + (qz - dz * t) * nz) / len;
			return { i: a, t, u, h: h[a] + (h[a + 1] - h[a]) * t };
		}
		return { i: hit.i, t: hit.t, u: hit.d * hit.side, h: hit.h };
	}

	/** Curvature at `t` along segment `a`, per metre and +left: its ends' curvatures, blended. */
	const curvature = (a: number, t: number) =>
		bend[a] + (bend[a + 1] - bend[a]) * t;

	return { offset, curvature };
}
