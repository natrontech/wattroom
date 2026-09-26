// A GPX becomes a Route: the road resampled every STEP metres in local
// metres, elevation smoothed so GPS altitude noise never reaches the
// trainer as a grade spike. Everything downstream (world, physics, the
// trainer's grade) reads the Route, never the GPX.

import { GpxError, type GpxPoint } from './gpx';

export type Route = {
	name: string;
	step: number; // metres between samples: about STEP, so the last one lands on the end
	length: number; // metres
	x: Float64Array; // east, metres from the route's centroid
	z: Float64Array; // south (three.js: -z is north), metres
	ele: Float64Array; // smoothed elevation, metres above sea
	grade: Float64Array; // percent, clamped
	gain: number;
	minEle: number;
	maxEle: number;
	loop: boolean;
};

const STEP = 10;
const SMOOTH_M = 120; // moving-average window for elevation
const GRADE_MIN = -15;
const GRADE_MAX = 20;
const EARTH_R = 6371008.8;
const SIGMA = 6; // metres; RESEARCH: σ 5–8 gives min radius 5.3–5.8 m and ≤3 m deviation

const closeGapOf = (px: number[], pz: number[]) =>
	Math.hypot(px[0] - px[px.length - 1], pz[0] - pz[pz.length - 1]);

// Drop duplicates and out-and-back reversals (a GPS track or a routed line
// that doubles back on itself for a few metres) — they whipped the camera
// round at 3000°/s.
function despike(px: number[], pz: number[], pe: number[]) {
	for (let changed = true; changed;) {
		changed = false;
		const keep: number[] = [0];
		for (let i = 1; i < px.length - 1; i++) {
			const k = keep[keep.length - 1];
			const ax = px[i] - px[k];
			const az = pz[i] - pz[k];
			const bx = px[i + 1] - px[i];
			const bz = pz[i + 1] - pz[i];
			const la = Math.hypot(ax, az);
			const lb = Math.hypot(bx, bz);
			const cos = (ax * bx + az * bz) / (la * lb || 1);
			if (la < 0.5 || (cos < -0.866 && Math.min(la, lb) < 40)) {
				changed = true;
				continue;
			}
			keep.push(i);
		}
		keep.push(px.length - 1);
		px = keep.map((i) => px[i]);
		pz = keep.map((i) => pz[i]);
		pe = keep.map((i) => pe[i]);
	}
	return { px, pz, pe };
}

export function toRoute(name: string, points: GpxPoint[]): Route {
	const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
	const lon0 = points.reduce((s, p) => s + p.lon, 0) / points.length;
	const kx = (Math.PI / 180) * EARTH_R * Math.cos((lat0 * Math.PI) / 180);
	const kz = (Math.PI / 180) * EARTH_R;
	const { px, pz, pe } = despike(
		points.map((p) => (p.lon - lon0) * kx),
		points.map((p) => -(p.lat - lat0) * kz),
		points.map((p) => p.ele),
	);
	const loop = closeGapOf(px, pz) < 200 && points.length > 3;

	// Resample every metre, then a Gaussian (σ = 6 m) on the centreline:
	// every kink becomes a curve of at least ~5 m radius, the line moves at
	// most a couple of metres, and the length stays the drawn length.
	const fine = resample(px, pz, pe, 1);
	if (fine.length < 2 * STEP)
		throw new GpxError(
			`This track covers only ${Math.round(fine.length)} m, too little to build a road on. Pick a longer track.`,
		);
	const sx = gaussian(fine.x, SIGMA, loop);
	const sz = gaussian(fine.z, SIGMA, loop);
	const line = resample(
		Array.from(sx),
		Array.from(sz),
		Array.from(fine.e),
		STEP,
	);
	const { x, z, e: raw, length, step } = line;
	const n = x.length;

	const ele = movingAverage(raw, Math.max(1, Math.round(SMOOTH_M / step / 2)));
	const grade = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		const a = Math.max(0, i - 1);
		const b = Math.min(n - 1, i + 1);
		const g = ((ele[b] - ele[a]) / ((b - a) * step)) * 100;
		grade[i] = Math.min(GRADE_MAX, Math.max(GRADE_MIN, g));
	}
	let gain = 0;
	let minEle = Infinity;
	let maxEle = -Infinity;
	for (let i = 0; i < n; i++) {
		if (i > 0) gain += Math.max(0, ele[i] - ele[i - 1]);
		minEle = Math.min(minEle, ele[i]);
		maxEle = Math.max(maxEle, ele[i]);
	}
	return {
		name,
		step,
		length,
		x,
		z,
		ele,
		grade,
		gain,
		minEle,
		maxEle,
		loop,
	};
}

// Evenly spaced samples, about `about` metres apart, the last one exactly on
// the line's end. A smoothed loop ends where it began and at() joins the two;
// a sample stopping short of the end left a stub riders stalled on every lap.
function resample(px: number[], pz: number[], pe: number[], about: number) {
	const cum = [0];
	for (let i = 1; i < px.length; i++)
		cum.push(cum[i - 1] + Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]));
	const length = cum[cum.length - 1];
	const n = Math.max(1, Math.round(length / about)) + 1;
	const step = length / (n - 1);
	const x = new Float64Array(n);
	const z = new Float64Array(n);
	const e = new Float64Array(n);
	let j = 0;
	for (let i = 0; i < n; i++) {
		const d = Math.min(i * step, length);
		while (j < cum.length - 2 && cum[j + 1] < d) j++;
		const t = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
		x[i] = px[j] + (px[j + 1] - px[j]) * t;
		z[i] = pz[j] + (pz[j + 1] - pz[j]) * t;
		e[i] = pe[j] + (pe[j + 1] - pe[j]) * t;
	}
	return { x, z, e, length, step };
}

function gaussian(a: Float64Array, sigma: number, loop: boolean): Float64Array {
	const r = Math.ceil(sigma * 3);
	const w = Array.from({ length: 2 * r + 1 }, (_, k) =>
		Math.exp(-((k - r) ** 2) / (2 * sigma * sigma)),
	);
	const n = a.length;
	const out = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		let s = 0;
		let ws = 0;
		for (let k = -r; k <= r; k++) {
			let j = i + k;
			if (loop) j = ((j % (n - 1)) + (n - 1)) % (n - 1);
			else if (j < 0 || j >= n) continue;
			s += a[j] * w[k + r];
			ws += w[k + r];
		}
		out[i] = s / ws;
	}
	if (!loop) {
		out[0] = a[0];
		out[n - 1] = a[n - 1];
	}
	return out;
}

function movingAverage(a: Float64Array, half: number): Float64Array {
	const out = new Float64Array(a.length);
	for (let i = 0; i < a.length; i++) {
		let s = 0;
		let c = 0;
		const hi = Math.min(a.length - 1, i + half);
		for (let k = Math.max(0, i - half); k <= hi; k++) {
			s += a[k];
			c++;
		}
		out[i] = s / c;
	}
	return out;
}

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
