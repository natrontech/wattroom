import { packRoad, roadStep, type Road } from '$lib/road/road';
import { cosDeg, sinDeg } from './sine';

/**
 * The only road the generator ever walks (#3224): nothing in $lib/world reads
 * a route. Until the map's strokes arrive (#3239) the served road is its own
 * single stroke, and its frame is rebuilt from the road's own turns — so a
 * route's owner, who holds its coordinates, and a crewmate, who holds only
 * its profile, build one world over the span.
 */

/** Metres between a stroke's vertices. */
export const STROKE_STEP_M = 2;
/** A stored step is walked in this many parts, so a turn bends over its ~20 m rather than at a corner. */
const PARTS = 10;

export type Stroke = {
	/** Opaque: it names the stroke's data, never its place. */
	key: string;
	/** True when the canonical start is the served road's last sample. */
	reversed: boolean;
	/** The metre along the stroke of its first vertex. */
	startM: number;
	length: number;
	/** x0, z0, x1, z1 … every STROKE_STEP_M in the key frame; the last vertex is the end. */
	points: Float64Array;
};

/** The road ridden the other way: 'Ride back the way you came' (#3205). */
export function reverseRoad(road: Road): Road {
	return {
		length: road.length,
		heights: [...road.heights].reverse(),
		turns: road.turns.map((t) => (t === 0 ? 0 : -t)).reverse(),
	};
}

/** Byte order of two packed roads: the canonical direction is the smaller. */
function before(a: Uint8Array, b: Uint8Array): boolean {
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] < b[i];
	return a.length < b.length;
}

/** The road's centreline at every part, from its turns alone, heading 0 at its start. */
function walk(road: Road): { x: Float64Array; z: Float64Array; part: number } {
	const steps = road.turns.length;
	const part = roadStep(road) / PARTS;
	const x = new Float64Array(steps * PARTS + 1);
	const z = new Float64Array(steps * PARTS + 1);
	let heading = 0;
	let k = 0;
	for (let i = 0; i < steps; i++) {
		const turn = road.turns[i];
		for (let j = 0; j < PARTS; j++) {
			const deg = heading + Math.floor((turn * (2 * j + 1)) / (2 * PARTS));
			x[k + 1] = x[k] + part * cosDeg(deg);
			z[k + 1] = z[k] + part * sinDeg(deg);
			k++;
		}
		heading += turn;
	}
	return { x, z, part };
}

/** The walked centreline resampled every STROKE_STEP_M by arc length. */
function resample(road: Road): Float64Array {
	const { x, z, part } = walk(road);
	const last = x.length - 1;
	const count = Math.floor(road.length / STROKE_STEP_M) + 1;
	const ends = road.length > (count - 1) * STROKE_STEP_M ? 1 : 0;
	const points = new Float64Array(2 * (count + ends));
	const put = (q: number, s: number) => {
		const at = Math.min(s / part, last);
		const k = Math.min(Math.floor(at), last - 1);
		const f = at - k;
		points[2 * q] = x[k] + (x[k + 1] - x[k]) * f;
		points[2 * q + 1] = z[k] + (z[k + 1] - z[k]) * f;
	};
	for (let q = 0; q < count; q++) put(q, q * STROKE_STEP_M);
	if (ends) put(count, road.length);
	return points;
}

/**
 * The served road as its own stroke, keyed by the served road's hash `h`
 * (which names its data snapshot). Either direction of one road gives the
 * same stroke: it is always built from the direction whose packed bytes sort
 * first. Anything else the served payload carries — the owner's shape —
 * never reaches the frame.
 */
export function strokeOf(served: { h: string; road: Road }): Stroke {
	const back = reverseRoad(served.road);
	const reversed = before(packRoad(back), packRoad(served.road));
	return {
		key: served.h,
		reversed,
		startM: 0,
		length: served.road.length,
		points: resample(reversed ? back : served.road),
	};
}

/** Where a rider `metre` along the road they ride is, in metres along the stroke. */
export const strokeMetre = (stroke: Stroke, metre: number): number =>
	stroke.startM + (stroke.reversed ? stroke.length - metre : metre);
