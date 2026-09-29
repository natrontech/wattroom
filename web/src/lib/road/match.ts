/**
 * Terrain Match (#3099): where on a road to start a workout so its hard blocks
 * land on the climbs. The reference rider rides the prescribed workout from
 * every start, a second at a time on the pace model, and a start scores how
 * well the targets follow the grade, less the time spent crawling. On by
 * default; km 0 stays one tap away, so it is always scored too.
 */
import {
	BikeKg,
	BunchMaxPct,
	PaceDefaultCdA,
	ReferenceRiderKg,
	ReferenceRiderWatts,
} from '$lib/protocol';
import { flatten, segmentsDuration, targetAt } from '$lib/workout/engine';
import type { Workout } from '$lib/workout/types';
import { createPace, steadySpeed } from './pace';
import { roadStep, type Road } from './road';

/** docs/SPEC.md "Riding a road together": the start step, the slow penalty's weight, and the floor under which a start is not worth proposing. */
const STEP_M = 250;
const SLOW_WEIGHT = 0.3;
const FLOOR = 0.2;
/** The issue's crawl (#3099): a second under 10 km/h counts against a start. */
const SLOW_MPS = 10 / 3.6;

export type Start = {
	/** Metres along the road in the direction ridden. */
	startM: number;
	reverse: boolean;
	/** corr(target, grade) − SLOW_WEIGHT × slow. */
	score: number;
	corr: number;
	/** Share of the ride's seconds under 10 km/h. */
	slow: number;
};

export type TerrainMatch = {
	best: Start;
	/** Forward from km 0, for the picker's one-tap way back. */
	fromZero: Start;
	/** Even the best start is under the floor: the compiled road workout fits this road better (#3026). */
	suggestRoad: boolean;
};

/** The workout as fractions of FTP, a second at a time; a sprint rides at the bunch's most. */
function fractionsOf(workout: Workout): number[] {
	const segments = flatten(workout);
	return Array.from({ length: segmentsDuration(segments) }, (_, t) => {
		const watts = targetAt(segments, ReferenceRiderWatts, t).targetWatts;
		return watts === null ? BunchMaxPct : watts / ReferenceRiderWatts;
	});
}

/** The grade in % at `m` metres along the road as ridden; past the end, flat. */
function gradeAt(road: Road, m: number, reverse: boolean): number {
	if (m >= road.length) return 0;
	const step = roadStep(road);
	const at = reverse ? road.length - m : m;
	// Forward, the step ahead of `at`; reversed, the step behind it.
	const i = Math.min(
		Math.max(reverse ? Math.ceil(at / step) - 1 : Math.floor(at / step), 0),
		road.heights.length - 2,
	);
	const grade = ((road.heights[i + 1] - road.heights[i]) / step) * 100;
	return reverse ? -grade : grade;
}

function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
	const n = a.length;
	let [ma, mb] = [0, 0];
	for (let i = 0; i < n; i++) {
		ma += a[i] / n;
		mb += b[i] / n;
	}
	let [ab, aa, bb] = [0, 0, 0];
	for (let i = 0; i < n; i++) {
		ab += (a[i] - ma) * (b[i] - mb);
		aa += (a[i] - ma) ** 2;
		bb += (b[i] - mb) ** 2;
	}
	// A flat road or a steady workout follows nothing.
	return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

/** One start ridden through; null when the ride runs off the road's end and it is not a loop. */
function ride(
	road: Road,
	fractions: number[],
	startM: number,
	reverse: boolean,
	loop: boolean,
	clip = false,
): Start | null {
	const mass = ReferenceRiderKg + BikeKg;
	const pace = createPace(
		steadySpeed(
			fractions[0] * ReferenceRiderWatts,
			gradeAt(road, startM, reverse),
			mass,
			PaceDefaultCdA,
		),
	);
	const grades = new Float64Array(fractions.length);
	let slow = 0;
	for (let t = 0; t < fractions.length; t++) {
		let m = startM + pace.distance;
		if (loop) m %= road.length;
		else if (m >= road.length && !clip) return null;
		grades[t] = gradeAt(road, m, reverse);
		pace.step(
			fractions[t] * ReferenceRiderWatts,
			grades[t],
			mass,
			PaceDefaultCdA,
			0,
		);
		if (pace.speed < SLOW_MPS) slow++;
	}
	const corr = pearson(fractions, grades);
	slow /= fractions.length;
	return { startM, reverse, score: corr - SLOW_WEIGHT * slow, corr, slow };
}

/**
 * The best start for this workout on this road, in both directions. A
 * point-to-point road only offers the starts the whole workout fits after;
 * km 0 is scored whatever, riding flat past the end if it has to.
 */
export function matchTerrain(
	road: Road,
	workout: Workout,
	loop = false,
): TerrainMatch {
	const fractions = fractionsOf(workout);
	const fromZero = ride(road, fractions, 0, false, loop, true)!;
	let best = fromZero;
	for (const reverse of [false, true])
		for (let startM = 0; startM < road.length; startM += STEP_M) {
			const start = ride(road, fractions, startM, reverse, loop);
			if (start && start.score > best.score) best = start;
		}
	return { best, fromZero, suggestRoad: best.score < FLOOR };
}
