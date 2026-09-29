/**
 * The track as a line in local metres (#3023): projected around its own
 * centroid, cleared of GPS spikes, resampled and smoothed. x runs east and z
 * south, three.js's frame, so the world reads it as it stands.
 */
import type { TrackPoint } from './parse';

const EARTH_R = 6371008.8;

export type Line = { x: number[]; z: number[]; e: number[] };

export type Frame = { lat0: number; lon0: number; kx: number; kz: number };

/** An equirectangular frame at the track's centroid: metres per degree east and south. */
export function frameOf(points: TrackPoint[]): Frame {
	const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
	const lon0 = points.reduce((s, p) => s + p.lon, 0) / points.length;
	const kz = (Math.PI / 180) * EARTH_R;
	return { lat0, lon0, kx: kz * Math.cos((lat0 * Math.PI) / 180), kz };
}

export function project(points: TrackPoint[], f: Frame): Line {
	return {
		x: points.map((p) => (p.lon - f.lon0) * f.kx),
		z: points.map((p) => -(p.lat - f.lat0) * f.kz),
		e: points.map((p) => p.ele),
	};
}

export function unproject(x: number, z: number, f: Frame) {
	return { lat: f.lat0 - z / f.kz, lon: f.lon0 + x / f.kx };
}

/**
 * A spike is the path coming back to within this of a point it passed
 * SPIKE_MIN_M to SPIKE_MAX_M earlier: a fix thrown off and walked back, or a
 * few metres of doubling back. A real switchback never does — its legs are
 * twice its radius apart, 18 m on a 9 m hairpin — which is why this is not
 * judged by heading: a heading rule deletes the hairpin with the spike.
 */
const SPIKE_RETURN_M = 5;
const SPIKE_MIN_M = 20;
const SPIKE_MAX_M = 60;
/** Closer than this to the last kept fix is the same fix twice. */
const SAME_FIX_M = 0.5;

/**
 * Drops each excursion the path makes and returns from. The earliest point it
 * comes back to anchors the cut, and no later cut reaches behind where the
 * last one resumed: an out-and-back route runs back down its own way in, and
 * without that floor every step of the way back would read as a spike on the
 * way out, eating the return leg a cut at a time.
 */
export function despike({ x, z, e }: Line): Line & { cuts: number } {
	// cuts: how many spikes were cut out, for the importer's "what we fixed".
	const out = { x: [x[0]], z: [z[0]], e: [e[0]], cuts: 0 };
	const along = [0];
	let floor = 0;
	for (let i = 1; i < x.length; i++) {
		const last = out.x.length - 1;
		const step = Math.hypot(x[i] - out.x[last], z[i] - out.z[last]);
		if (step < SAME_FIX_M) continue;
		const at = along[last] + step;
		let back = -1;
		for (let j = last; j >= floor && at - along[j] <= SPIKE_MAX_M; j--)
			if (
				at - along[j] >= SPIKE_MIN_M &&
				Math.hypot(x[i] - out.x[j], z[i] - out.z[j]) < SPIKE_RETURN_M
			)
				back = j;
		if (back >= 0) {
			out.cuts++;
			for (const a of [out.x, out.z, out.e, along]) a.length = back + 1;
			along.push(
				along[back] + Math.hypot(x[i] - out.x[back], z[i] - out.z[back]),
			);
			floor = back + 1;
		} else along.push(at);
		out.x.push(x[i]);
		out.z.push(z[i]);
		out.e.push(e[i]);
	}
	return out;
}

/** A track whose ends are this close is a loop. */
const LOOP_GAP_M = 200;

export function isLoop({ x, z }: Line): boolean {
	const n = x.length - 1;
	return n > 2 && Math.hypot(x[0] - x[n], z[0] - z[n]) < LOOP_GAP_M;
}

export type Samples = {
	x: Float64Array;
	z: Float64Array;
	e: Float64Array;
	length: number;
	step: number;
};

/**
 * `intervals` evenly spaced steps along the line, the last sample exactly on
 * its end. A smoothed loop ends where it began and the world joins the two; a
 * sample stopping short of the end left a stub riders stalled on every lap.
 */
export function resample({ x, z, e }: Line, intervals: number): Samples {
	const cum = [0];
	for (let i = 1; i < x.length; i++)
		cum.push(cum[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]));
	const length = cum[cum.length - 1];
	const n = intervals + 1;
	const step = length / intervals;
	const out = {
		x: new Float64Array(n),
		z: new Float64Array(n),
		e: new Float64Array(n),
	};
	let j = 0;
	for (let i = 0; i < n; i++) {
		const d = Math.min(i * step, length);
		while (j < cum.length - 2 && cum[j + 1] < d) j++;
		const t = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
		out.x[i] = x[j] + (x[j + 1] - x[j]) * t;
		out.z[i] = z[j] + (z[j + 1] - z[j]) * t;
		out.e[i] = e[j] + (e[j + 1] - e[j]) * t;
	}
	return { ...out, length, step };
}

/**
 * A Gaussian of `sigma` samples along the line. On a line sampled every
 * metre, σ 6 turns every kink into a curve of at least ~5 m radius and moves
 * the line a couple of metres at most. A loop wraps; an open line keeps its
 * ends where they were.
 */
export function gaussian(
	a: Float64Array,
	sigma: number,
	loop: boolean,
): Float64Array {
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
