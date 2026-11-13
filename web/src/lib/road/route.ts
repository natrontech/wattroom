/**
 * A route file's points become a Route (#3023): everything downstream — the
 * world, the physics, the trainer's grade, the stored road — reads this,
 * never the file. The steps and their numbers are docs/SPEC.md "Route rides"'s:
 *
 * 1. project to local metres (line.ts);
 * 2. drop GPS spikes by where the path returns, not by heading;
 * 3. a Gaussian, σ 6 m, on the line resampled every metre;
 * 4. resample every 10 m;
 * 5. heights: a 200 m median, then a 120 m average (profile.ts);
 * 6. hold the grade to −15 … +20 %;
 * 7. turns: the heading's change every stored step, as int8 degrees;
 * 8. the road every 20 m, packed and hashed (road.ts), and the owner's shape;
 * 9. its climbs, read off that road (climbs.ts).
 *
 * Deterministic: the same points always make the same Route, byte for byte.
 */
import * as protocol from '#lib/protocol.ts';
import { climbsOf, type Climb } from './climbs';
import {
	despike,
	frameOf,
	gaussian,
	isLoop,
	project,
	resample,
	unproject,
} from './line';
import { RouteError, type TrackPoint } from './parse';
import {
	AVERAGE_M,
	MEDIAN_M,
	gainOf,
	gradeOf,
	holdGrade,
	movingAverage,
	roadName,
	rollingMedian,
	turnsOf,
} from './profile';
import { encodePolyline6, type Road } from './road';

export type Route = {
	/** Generated from its numbers (roadName); the file's own name is never read. */
	name: string;
	/** Metres between samples: about STEP_M, so the last one lands on the end. */
	step: number;
	/** Metres. */
	length: number;
	/** East, metres from the route's centroid. */
	x: Float64Array;
	/** South (three.js: −z is north), metres. */
	z: Float64Array;
	/** Smoothed height, metres above sea. */
	ele: Float64Array;
	/** Percent, inside the stored grade range. */
	grade: Float64Array;
	gain: number;
	minEle: number;
	maxEle: number;
	loop: boolean;
	/** What anyone but the owner may be sent: every other sample's height, and the turns between. */
	road: Road;
	/** The owner's shape, polyline6 of the smoothed line — sealed by the server, never shown to anyone else. */
	shape: string;
	/** Read off `road`, so the server's twin finds the same ones (#3238). */
	climbs: Climb[];
	/**
	 * What the pipeline changed, beyond the smoothing every route gets
	 * (#3057): GPS spikes cut out, and metres whose grade was held to the
	 * stored range.
	 */
	fixed: { spikes: number; heldM: number };
	/**
	 * The world's road only (#4531): per sample, how far it is drawn on an
	 * earlier pass of the same road, 1 on it, easing between (shared-road.ts).
	 * Absent where the route never rides a road twice.
	 */
	shared?: Float64Array;
	/**
	 * The world's road only: where it meets another road at a junction
	 * (world/side-roads.ts). Between metres `from` and `to` its paint reads its
	 * distance to that road's line (x, z) and gives way as `role` says
	 * (world/crossings.ts JOINS, JOINED).
	 */
	/** The world's road only: drawn level across, not banked into its bend. A roundabout's ring (world/designed.ts). */
	level?: boolean;
	/** The world's road only: per sample, how far its bank is taken out, 1 drawn level across. The road ridden where it laps a roundabout's level arm (world/world.ts). */
	flat?: Float64Array;
	/** The world's road only: how many times its own width it is drawn at metre `d`. A roundabout's arm flares where it meets the ring (world/designed.ts). */
	widen?: (d: number) => number;
	meets?: {
		from: number;
		to: number;
		x: ArrayLike<number>;
		z: ArrayLike<number>;
		role: number;
	}[];
	/**
	 * The world's road only: the designed scene it is drawn in, by its id
	 * (world/designed.ts). Absent on every road but WattRoom's designed ones.
	 */
	scene?: string;
	/**
	 * The world's road only: the stretches, in metres along it, where it
	 * meets another pass of itself at one height, a crossroads or a road
	 * joining a road, each with the metres of the pass it meets and which of
	 * the two it is (crossings.ts Meeting). Absent where it meets none.
	 */
	bare?: readonly (readonly [
		from: number,
		to: number,
		otherFrom: number,
		otherTo: number,
		as: number,
	])[];
};

/** docs/SPEC.md: resample every 10 m, store every 20 m. */
const STEP_M = 10;
const STORE_EVERY = 2;
/** The Gaussian on the centreline, in metres, on a line resampled every metre. */
const SIGMA_M = 6;

const cm = (m: number) => Math.round(m * 100) / 100;

export function toRoute(points: TrackPoint[]): Route {
	const frame = frameOf(points);
	const clean = despike(project(points, frame));
	const loop = isLoop(clean);

	// Before the resample, which allocates a sample a metre: a fix off the
	// globe made that an allocation failure blamed on us, not the file.
	const metres = lengthOf(clean);
	if (metres > protocol.MaxRouteMeters)
		throw new RouteError(
			`This track covers ${Math.round(metres / 1000)} km, and a route holds at most ${protocol.MaxRouteMeters / 1000} km. Split it into shorter routes and import each one.`,
		);
	const fine = resample(clean, Math.max(1, Math.round(metres)));
	if (fine.length < protocol.MinRouteMeters)
		throw new RouteError(
			`This track covers ${(fine.length / 1000).toFixed(1)} km, and a route needs at least ${protocol.MinRouteMeters / 1000} km. Pick a longer track.`,
		);
	const line = resample(
		{
			x: Array.from(gaussian(fine.x, SIGMA_M / fine.step, loop)),
			z: Array.from(gaussian(fine.z, SIGMA_M / fine.step, loop)),
			e: Array.from(fine.e),
		},
		// An even count of 10 m steps, so every other sample lands on the end.
		STORE_EVERY * Math.max(1, Math.round(fine.length / (STEP_M * STORE_EVERY))),
	);
	const { x, z, length, step } = line;

	const smoothed = movingAverage(
		rollingMedian(line.e, Math.round(MEDIAN_M / step / 2)),
		Math.max(1, Math.round(AVERAGE_M / step / 2)),
	);
	const ele = holdGrade(smoothed, step);
	let held = 0;
	for (let i = 1; i < ele.length; i++)
		if (Math.abs(ele[i] - ele[i - 1] - (smoothed[i] - smoothed[i - 1])) > 1e-9)
			held++;
	const grade = gradeOf(ele, step);

	const heights: number[] = [];
	for (let i = 0; i < ele.length; i += STORE_EVERY) heights.push(cm(ele[i]));
	const road: Road = {
		length: cm(length),
		heights,
		turns: turnsOf(x, z, STORE_EVERY),
	};

	const gain = gainOf(ele);
	let minEle = Infinity;
	let maxEle = -Infinity;
	for (const h of ele) {
		minEle = Math.min(minEle, h);
		maxEle = Math.max(maxEle, h);
	}
	const shape = encodePolyline6(
		Array.from(x, (xi, i) => unproject(xi, z[i], frame)),
	);
	return {
		name: roadName(length, gain),
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
		road,
		shape,
		climbs: climbsOf(road),
		fixed: { spikes: clean.cuts, heldM: held * step },
	};
}

export function lengthOf({ x, z }: { x: number[]; z: number[] }): number {
	let s = 0;
	for (let i = 1; i < x.length; i++)
		s += Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]);
	return s;
}
