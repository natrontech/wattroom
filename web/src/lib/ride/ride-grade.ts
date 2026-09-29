import { MaxTrainerGrade } from '$lib/protocol';
import { at } from '$lib/road/along';
import type { Route } from '$lib/road/route';

/**
 * docs/SPEC.md's route-ride numbers (ADR-0062), defaults until the Kickr
 * sitting (#3350) makes them final (#3351). No road number appears here
 * before it appears there.
 */
export const ROAD = {
	/** The share of a road's grade a rider feels: 50 %, 100 % under Advanced. */
	difficulty: 0.5,
	/** Descents are felt at this share again: a trainer cannot push the pedals. */
	descent: 0.5,
	/** The felt floor; the ceiling is MaxTrainerGrade (ADR-0062's one ceiling). */
	feltMin: -5,
	/** How fast the felt grade may move, % per second. */
	slewPerSecond: 1,
	/** How far ahead of the rider the road is read, at the dot's speed. */
	lookAheadSeconds: 1,
	/** Entering SIM from ERG: flat for this long first. */
	entryFlatMs: 500,
	/**
	 * ERG-by-road, as shares of FTP: base + perGrade × the road's grade %,
	 * held between min and max, and min outright below descentBelow %.
	 */
	ergByRoad: {
		base: 0.6,
		perGrade: 0.03,
		min: 0.5,
		max: 0.9,
		descentBelow: -2,
	},
} as const;

const clamp = (v: number, lo: number, hi: number) =>
	Math.min(hi, Math.max(lo, v));

/**
 * The grade a rider feels on a road (docs/SPEC.md "Felt grade"): difficulty ×
 * grade, halved again on descents, clamped. Roads only: the free ride's
 * hand-set grade and a sprint's slope are felt already, and difficulty never
 * touches them. The dot always moves by the road's own grade.
 */
export function feltGrade(
	roadPct: number,
	difficulty: number = ROAD.difficulty,
): number {
	const felt = roadPct * difficulty * (roadPct < 0 ? ROAD.descent : 1);
	return clamp(felt, ROAD.feltMin, MaxTrainerGrade);
}

/**
 * What a road asks of the trainer, second by second (#3025): the felt grade
 * of the road a second ahead of the rider, slewed at most ROAD.slewPerSecond
 * from the last. A new road starts where it stands; the flat on entering SIM
 * is the actuator's. A shift is neither slewed nor spaced (ADR-0084) — it is
 * not a road write.
 */
export function createRideGrade(difficulty: number = ROAD.difficulty) {
	let last: number | undefined;
	return {
		/** At `distance` metres, moving at the dot's `speed` (m/s), `seconds` after the last. */
		at(route: Route, distance: number, speed: number, seconds = 1): number {
			const ahead = distance + speed * ROAD.lookAheadSeconds;
			const target = feltGrade(at(route, ahead).grade, difficulty);
			const step = ROAD.slewPerSecond * seconds;
			last =
				last === undefined ? target : last + clamp(target - last, -step, step);
			return last;
		},
		/** Off the road: the next one starts where it stands. */
		reset() {
			last = undefined;
		},
	};
}

/**
 * A one-gear rider on a road (ERG-by-road, docs/SPEC.md): wherever WattRoom
 * would put them on a slope, the trainer holds watts instead, scaled by the
 * road's own grade and the rider's bias.
 */
export function ergByRoad(ftp: number, roadPct: number, bias = 1): number {
	const { base, perGrade, min, max, descentBelow } = ROAD.ergByRoad;
	const share =
		roadPct < descentBelow ? min : clamp(base + perGrade * roadPct, min, max);
	return Math.round(ftp * share * bias);
}
