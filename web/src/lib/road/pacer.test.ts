import { describe, expect, it } from 'vitest';
import {
	BikeKg,
	PaceDefaultCdA,
	ParWkgC,
	ReferenceRiderKg,
} from '$lib/protocol';
import { legsRoad } from './fixtures';
import { finishedIn } from './ghost';
import { createPace, steadySpeed } from './pace';
import { PACER_SURGE, PACER_W_PRIME, pacerLine, pacerWatts } from './pacer';

const MASS = ReferenceRiderKg + BikeKg;
const CP = ParWkgC * ReferenceRiderKg;

/** The pace model's own finish at steady watts, in fractional seconds. */
function paceFinish(lengthM: number, grade: number, watts: number): number {
	const pace = createPace();
	let s = 0;
	let before = 0;
	while (pace.distance < lengthM) {
		before = pace.distance;
		pace.step(watts, grade, MASS, PaceDefaultCdA, 0);
		s++;
	}
	return s - 1 + (lengthM - before) / (pace.distance - before);
}

describe('the pacer surges on ramps while its W′ lasts (#3281)', () => {
	it('surges to 110 % of par from 4 %, never below it', () => {
		expect(pacerWatts(CP, 4, PACER_W_PRIME)).toBeCloseTo(CP * PACER_SURGE);
		expect(pacerWatts(CP, 3.9, PACER_W_PRIME)).toBe(CP);
		expect(pacerWatts(CP, -6, PACER_W_PRIME)).toBe(CP);
	});

	it('holds par once its balance is down to a quarter of W′', () => {
		expect(pacerWatts(CP, 8, PACER_W_PRIME * 0.25 + 1)).toBeCloseTo(
			CP * PACER_SURGE,
		);
		expect(pacerWatts(CP, 8, PACER_W_PRIME * 0.25)).toBe(CP);
	});
});

describe('the pacer on a road (#3281)', () => {
	it('at par finishes a flat fixture within 1 s of the pace model', () => {
		const road = legsRoad([10_000, 0]);
		const line = pacerLine(road, ParWkgC);
		expect(
			Math.abs(finishedIn(line, road.length) - paceFinish(road.length, 0, CP)),
		).toBeLessThan(1);
	});

	it('climbs at 110 % of par first, then at par once W′ is spent', () => {
		const road = legsRoad([12_000, 6.5]);
		const line = pacerLine(road, ParWkgC);
		const mps = (s: number) => line[s + 1] - line[s];
		// 15 kJ of W′ at 21.4 W over CP lasts about 700 s.
		expect(mps(300)).toBeCloseTo(
			steadySpeed(CP * PACER_SURGE, 6.5, MASS, PaceDefaultCdA),
			2,
		);
		expect(mps(1200)).toBeCloseTo(
			steadySpeed(CP, 6.5, MASS, PaceDefaultCdA),
			2,
		);
		// Faster than par held, slower than the surge held the whole way.
		const finish = finishedIn(line, road.length);
		expect(finish).toBeLessThan(paceFinish(road.length, 6.5, CP));
		expect(finish).toBeGreaterThan(
			paceFinish(road.length, 6.5, CP * PACER_SURGE),
		);
	});

	it('starts where a resumed ride starts and stops at the end', () => {
		const road = legsRoad([2_000, 0]);
		const line = pacerLine(road, ParWkgC, 1_500);
		expect(line[0]).toBe(1_500);
		expect(line.at(-1)).toBe(road.length);
	});
});
