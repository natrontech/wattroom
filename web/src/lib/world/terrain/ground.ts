import { keyer, unit, type Kind, type Salt } from '../place/keyed';
import { CHUNK_M, COARSE_M } from '../place/lattice';
import { smoothstep } from '../rand';
import { patchJunctions } from './junctions';
import { canonical, FAR_W, indexLines, type Line } from './lines';
import { roadFrame } from './road-frame';
import { across, bankOf, FORMATION } from './road-profile';

/**
 * The place's ground as one function of position (#3075, ADR-0081): the same
 * height at the same spot whichever route reaches it. Natural ground is the
 * height model where the place has one; before map data, a base field from
 * the roads' own heights, with relief keyed by the world's salt in the key
 * frame's lattice. Every road within 60 m then clamps it with real
 * earthworks, so a road sits on a shelf and a hairpin's inside is one bank.
 * The route decides nothing here: which lines exist is the map's, and the
 * order they are listed in is undone first.
 */

const BENCH = 7; // flat verge before a cutting starts — keeps a 10 m mesh off the asphalt
const CUT = 1.0; // 1:1 cut slope
const FILL = 0.667; // 1.5:1 fill slope
export const SUBGRADE = 0.45; // ground under the road sits this far below the surface
const EARTHWORKS_M = 60;
/** Every road's cut and fill bound the ground out to here; past it no natural ground is 267 m below a road. */
const CONE_M = 400;
/** How far out the natural ground's relief keeps rising from a road. */
const RISE_M = 1600;

/** The local frame's origin in the key frame, a chunk corner: x = e − e0, z = n0 − n. */
export type Origin = readonly [e: number, n: number];

export type GroundOpts = {
	salt: Salt;
	origin?: Origin;
	/** A height model, metres above the datum: the natural ground where the place has one. */
	model?: (x: number, z: number) => number;
};

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

type Keyer = ReturnType<typeof keyer>;

/** Keyed value noise with cells of `size` metres in the key frame, in [−1, 1]. */
function octave(k: Keyer, ground: boolean, size: number, e: number, n: number) {
	const i = Math.floor(e / size);
	const j = Math.floor(n / size);
	const u = fade(e / size - i);
	const v = fade(n / size - j);
	// The ground's 40 m octave is the chunk's own ground word (#3074); every other octave is its own stream.
	const at = (a: number, b: number) =>
		2 * unit(ground && size === COARSE_M ? k(a, b) : k(a, b, size)) - 1;
	const a = at(i, j);
	const b = at(i + 1, j);
	const c = at(i, j + 1);
	const d = at(i + 1, j + 1);
	const top = a + (b - a) * u;
	return top + (c + (d - c) * u - top) * v;
}

/**
 * Relief keyed by place: octaves of `sizes` metres, each half the last's
 * weight, in the key frame whose chunk corner `origin` is. What the ground
 * and the land on it vary by, never a seeded stream.
 */
export function relief(salt: Salt, origin: Origin = [0, 0]) {
	const [e0, n0] = origin;
	const keyers = new Map<Kind, Keyer>();
	return (kind: Kind, sizes: readonly number[], x: number, z: number) => {
		let k = keyers.get(kind);
		if (!k) keyers.set(kind, (k = keyer(salt, kind)));
		let sum = 0;
		let amp = 1;
		let norm = 0;
		for (const size of sizes) {
			sum += octave(k, kind === 'ground', size, e0 + x, n0 - z) * amp;
			norm += amp;
			amp *= 0.5;
		}
		return sum / norm;
	};
}
export type Relief = ReturnType<typeof relief>;

const HILLS = [8 * CHUNK_M, 4 * CHUNK_M, 2 * CHUNK_M];
const DETAIL = [CHUNK_M, 2 * COARSE_M, COARSE_M];
const SIDE = [16 * CHUNK_M];

export function makeGround(given: readonly Line[], opts: GroundOpts) {
	const noise = relief(opts.salt, opts.origin);
	const lines = patchJunctions(canonical(given));
	const index = indexLines(lines);
	const frame = roadFrame(index, lines);
	const span = Math.max(200, index.hi - index.lo);

	/** A value on a lattice of `size` metres, cached per point and read bilinearly between them. */
	function lattice(size: number, at: (x: number, z: number) => number) {
		const cache = new Map<number, number>();
		// ponytail: points wrap at 32,768 a side — 1,300 km of 40 m points, far past any coverage.
		const point = (a: number, b: number) => {
			const k = ((a & 0x7fff) << 15) | (b & 0x7fff);
			let v = cache.get(k);
			if (v === undefined) cache.set(k, (v = at(a * size, b * size)));
			return v;
		};
		return (x: number, z: number) => {
			const a = Math.floor(x / size);
			const b = Math.floor(z / size);
			const u = x / size - a;
			const v = z / size - b;
			const p00 = point(a, b);
			const p10 = point(a + 1, b);
			const p01 = point(a, b + 1);
			const p11 = point(a + 1, b + 1);
			const top = p00 + (p10 - p00) * u;
			return top + (p01 + (p11 - p01) * u - top) * v;
		};
	}

	const far = lattice(CHUNK_M, index.farField);
	const dist = lattice(
		COARSE_M,
		(x, z) => index.closest(x, z, RISE_M)?.d ?? RISE_M,
	);
	// The ground the roads sit in, before the detail: rising away from each road, hills farther out.
	const macro = lattice(COARSE_M, (x, z) => {
		const w = index.weighted(x, z);
		const base = (w.h * w.weight + far(x, z) * FAR_W) / (w.weight + FAR_W);
		const d = dist(x, z);
		const rise =
			Math.min(d, RISE_M) *
			(0.1 + 0.16 * noise('ground', SIDE, x, z)) *
			(0.6 + (base - index.lo) / span) *
			smoothstep(30, 300, d);
		const rugged = 40 + 0.08 * Math.max(0, base - 500);
		const hills =
			noise('ground', HILLS, x, z) * rugged * 2.2 * smoothstep(60, 700, d);
		return base + rise + hills;
	});

	/** The ground before any road cuts it. */
	function natural(x: number, z: number): number {
		if (opts.model) return opts.model(x, z);
		const detail =
			noise('ground', DETAIL, x, z) * 7 * smoothstep(15, 120, dist(x, z));
		return macro(x, z) + detail;
	}

	/**
	 * The drawn road's surface under (x, z), when a road runs there: the
	 * centre's height, banked into the bend and tucked at the shoulder — what
	 * the ribbon is drawn to and what road furniture stands on.
	 */
	function roadSurfaceAt(x: number, z: number): number | null {
		const at = frame.offset(x, z);
		if (!at || Math.abs(at.u) > FORMATION) return null;
		return at.h + across(at.u, bankOf(frame.curvature(at.i, at.t)));
	}

	/**
	 * The ground: natural, clamped by real earthworks. It may rise from a road
	 * no steeper than a 1:1 cutting (after a flat verge) and fall away no
	 * steeper than a 1.5:1 embankment — from every road within 60 m, so
	 * stacked switchbacks share one slope and a hairpin's inside is one bank.
	 */
	function heightAt(x: number, z: number): number {
		const hit = index.nearest(x, z, 2);
		if (hit && hit.d <= FORMATION) return hit.h - SUBGRADE;
		let lower = -Infinity;
		let upper = Infinity;
		const cone = (vh: number, d: number, slack: number) => {
			const dd = Math.max(0, d - FORMATION);
			lower = Math.max(lower, vh - SUBGRADE - FILL * dd - slack);
			upper = Math.min(
				upper,
				vh - SUBGRADE + CUT * Math.max(0, dd - BENCH) + slack,
			);
		};
		// Every road's cone, from vertices 20–30 m apart; near a road, every vertex and the
		// nearest point exactly. Those are tighter by under 2 m at 60 m, so they let go by
		// that much between 40 and 60 m before they drop out: no vertex leaves while it binds.
		const letGo = (d: number) => 2 * smoothstep(40, EARTHWORKS_M, d);
		index.thinWithin(x, z, CONE_M, (vh, d) => cone(vh, d, 0));
		index.within(x, z, EARTHWORKS_M, (vh, d) => cone(vh, d, letGo(d)));
		if (hit) cone(hit.h, hit.d, letGo(hit.d));
		const ground = natural(x, z);
		if (lower === -Infinity) return ground;
		if (lower > upper) return (lower + upper) / 2; // two roads disagree: a retaining wall's worth, split
		return smoothClamp(ground, lower, upper, 1.5);
	}

	/** Metres to the nearest road, read between 40 m lattice points: a cheap first cut, within about 20 m. */
	const roadDist = dist;

	return {
		heightAt,
		natural,
		roadSurfaceAt,
		roadDist,
		nearest: index.nearest,
		noise,
		lines,
	};
}

export type Ground = ReturnType<typeof makeGround>;

const smin = (a: number, b: number, k: number) => {
	const h = Math.max(k - Math.abs(a - b), 0) / k;
	return Math.min(a, b) - (h * h * k) / 4;
};
/**
 * v kept within [lo, hi], rounded over k where it meets a bound. The soft
 * minima overshoot by up to k/4 when the band is narrower than k — at the
 * formation's edge a cutting's ground rose 0.36 m above its own bench — so
 * the result is held to the band as well.
 */
const smoothClamp = (v: number, lo: number, hi: number, k: number) =>
	Math.min(hi, Math.max(lo, -smin(-smin(v, hi, k), -lo, k)));
