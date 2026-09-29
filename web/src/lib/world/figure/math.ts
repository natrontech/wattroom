import * as THREE from 'three';

/** The figure's small maths (#3070): vectors, easing and the profile curve every loft is drawn from. */

export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const X_ = V(1, 0, 0);
export const Y_ = V(0, 1, 0);
export const Z_ = V(0, 0, 1);
export const TAU = Math.PI * 2;
export const clamp = (x: number, a: number, b: number) =>
	Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sstep = (a: number, b: number, x: number) => {
	const t = clamp((x - a) / (b - a), 0, 1);
	return t * t * (3 - 2 * t);
};

/** A C1 cubic Hermite through knots. */
export function curve(pts: [number, number][]): (t: number) => number {
	const n = pts.length;
	return (t) => {
		if (t <= pts[0][0]) return pts[0][1];
		if (t >= pts[n - 1][0]) return pts[n - 1][1];
		let i = 0;
		while (t > pts[i + 1][0]) i++;
		const [t0, v0] = pts[i];
		const [t1, v1] = pts[i + 1];
		const h = t1 - t0;
		const u = (t - t0) / h;
		const m0 =
			i > 0 ? (v1 - pts[i - 1][1]) / (t1 - pts[i - 1][0]) : (v1 - v0) / h;
		const m1 =
			i < n - 2 ? (pts[i + 2][1] - v0) / (pts[i + 2][0] - t0) : (v1 - v0) / h;
		const u2 = u * u;
		const u3 = u2 * u;
		return (
			(2 * u3 - 3 * u2 + 1) * v0 +
			(u3 - 2 * u2 + u) * h * m0 +
			(-2 * u3 + 3 * u2) * v1 +
			(u3 - u2) * h * m1
		);
	};
}
