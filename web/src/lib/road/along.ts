// Where a rider is along a Route, and which way the road runs there (#3023):
// the world's reading of the road, moved here from $lib/world/route.ts with
// the pipeline that builds it.
import type { Route } from './route';

export type RoutePoint = {
	x: number;
	z: number;
	ele: number;
	grade: number;
	heading: number;
};

// Where a rider is at distance d along the route (d wraps on a loop). The
// position is a Catmull-Rom spline through the samples, so a rider rides the
// same curve the road is drawn on, and the heading is its smooth tangent.
export function at(r: Route, d: number): RoutePoint {
	const n = r.x.length;
	const dd = r.loop
		? ((d % r.length) + r.length) % r.length
		: Math.min(Math.max(d, 0), r.length);
	const f = Math.min(dd / r.step, n - 1.000001);
	const i = Math.floor(f);
	const t = f - i;
	const idx = (k: number) =>
		r.loop ? (k + n - 1) % (n - 1) : Math.min(n - 1, Math.max(0, k));
	const i0 = idx(i - 1);
	const i1 = idx(i);
	const i2 = idx(i + 1);
	const i3 = idx(i + 2);
	const cr = (a: Float64Array) => {
		const p0 = a[i0];
		const p1 = a[i1];
		const p2 = a[i2];
		const p3 = a[i3];
		return (
			0.5 *
			(2 * p1 +
				(-p0 + p2) * t +
				(2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
				(-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)
		);
	};
	const dcr = (a: Float64Array) => {
		const p0 = a[i0];
		const p1 = a[i1];
		const p2 = a[i2];
		const p3 = a[i3];
		return (
			0.5 *
			(-p0 +
				p2 +
				2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * t +
				3 * (-p0 + 3 * p1 - 3 * p2 + p3) * t * t)
		);
	};
	const lerp = (a: Float64Array) => a[i1] + (a[i2] - a[i1]) * t;
	return {
		x: cr(r.x),
		z: cr(r.z),
		ele: lerp(r.ele),
		grade: lerp(r.grade),
		heading: Math.atan2(dcr(r.x), dcr(r.z)),
	};
}

// Signed curvature (1/m, positive turning left) at sample i — drives the
// clearance on the inside of bends and the banking of the road.
export function curvature(r: Route, i: number): number {
	const n = r.x.length;
	const a = Math.max(0, i - 2);
	const b = Math.min(n - 1, i + 2);
	const h1 = Math.atan2(r.x[i] - r.x[a], r.z[i] - r.z[a]);
	const h2 = Math.atan2(r.x[b] - r.x[i], r.z[b] - r.z[i]);
	return wrapAngle(h2 - h1) / (((b - a) / 2) * r.step);
}

/** An angle folded into (−π, π]. */
export function wrapAngle(a: number): number {
	if (a > Math.PI) return a - 2 * Math.PI;
	if (a < -Math.PI) return a + 2 * Math.PI;
	return a;
}

// Left of travel, in three's x-east/z-south plane, for a heading.
export const leftOf = (heading: number) => ({
	lx: Math.cos(heading),
	lz: -Math.sin(heading),
});

// The unit frame of the segment at sample i: left of travel and heading.
export function frameAt(r: Route, i: number) {
	const j = Math.min(r.x.length - 2, Math.max(0, i));
	const dx = r.x[j + 1] - r.x[j];
	const dz = r.z[j + 1] - r.z[j];
	const l = Math.hypot(dx, dz) || 1;
	return { lx: dz / l, lz: -dx / l, heading: Math.atan2(dx, dz) };
}
