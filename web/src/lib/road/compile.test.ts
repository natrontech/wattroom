import { describe, expect, it } from 'vitest';
import { MaxLegSeconds } from '$lib/protocol';
import { durationSeconds } from '$lib/workout/engine';
import { validateWorkout } from '$lib/workout/validate';
import { climbsOf } from './climbs';
import { compileRoad, targetFor } from './compile';
import { hairpinClimb } from './fixtures';
import type { Road } from './road';
import { toRoute } from './route';

const FTP = 250;
const MASS = 83;

/** A road drawn as legs of [metres, percent], a sample every 20 m. */
function road(...legs: [number, number][]): Road {
	const heights = [500];
	for (const [metres, pct] of legs)
		for (let s = 0; s < metres; s += 20)
			heights.push(heights[heights.length - 1] + (pct / 100) * 20);
	return {
		length: 20 * (heights.length - 1),
		heights,
		turns: new Array(heights.length - 1).fill(0),
	};
}

function compiled(r: Road, ftp = FTP) {
	return compileRoad(
		{ id: 'route-1', name: 'Road · test', road: r, climbs: climbsOf(r) },
		ftp,
		MASS,
	);
}

describe('targetFor, ERG by the road', () => {
	it.each([
		[0, 0.6],
		[5, 0.75],
		[10, 0.9],
		[20, 0.9],
		[-3, 0.51],
		[-10, 0.5],
	])('at %d %% asks %s of FTP', (grade, target) => {
		expect(targetFor(grade)).toBeCloseTo(target, 10);
	});
});

describe('compileRoad', () => {
	// Flat, a 6 % climb, flat: three blocks, the climb's the hardest, each
	// pinned to where its stretch of road ends.
	it('makes one block per climb or flat stretch, pinned to the road', () => {
		const [leg, ...more] = compiled(road([2000, 0], [3000, 6], [2000, 0]));
		expect(more).toEqual([]);
		expect(leg.road).toEqual({
			routeId: 'route-1',
			fromM: 0,
			toM: 7000,
			stepEndM: [2000, 5000, 7000],
		});
		expect(leg.steps.map((s) => s.type === 'steady' && s.target)).toEqual([
			0.6, 0.78, 0.6,
		]);
		const [flat, climb] = leg.steps.map((s) =>
			s.type === 'steady' ? s.seconds : 0,
		);
		// The climb is 1.5× the flat's length and far slower per metre.
		expect(climb).toBeGreaterThan(1.5 * flat);
		expect(validateWorkout(leg).ok).toBe(true);
	});

	// A route longer than a sitting compiles into legs of at most six hours,
	// end to end along the road, and no block is longer than a step may be.
	it('splits a long route into legs a sitting can ride', () => {
		const legs = compiled(road([200_000, 0]), 100);
		expect(legs.length).toBeGreaterThan(1);
		let from = 0;
		for (const leg of legs) {
			expect(durationSeconds(leg)).toBeLessThanOrEqual(MaxLegSeconds);
			expect(leg.road?.fromM).toBe(from);
			expect(validateWorkout(leg).ok).toBe(true);
			from = leg.road!.toM;
		}
		expect(from).toBe(200_000);
		expect(legs[0].name).toMatch(/leg 1 of \d$/);
	});

	// The 21-hairpin fixture through the whole pipeline: its blocks end in
	// order along the road, the last one on its end.
	it('compiles a fixture route end to end', () => {
		const r = toRoute(hairpinClimb());
		const [leg] = compileRoad(
			{ id: 'route-2', name: r.name, road: r.road, climbs: r.climbs },
			FTP,
			MASS,
		);
		const ends = leg.road!.stepEndM!;
		expect(ends).toEqual([...ends].sort((a, b) => a - b));
		expect(ends.at(-1)).toBeCloseTo(r.road.length, 6);
		expect(leg.steps.length).toBe(ends.length);
		expect(validateWorkout(leg).ok).toBe(true);
	});
});
