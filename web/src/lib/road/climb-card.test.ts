import { describe, expect, it } from 'vitest';
import { PaceDefaultCdA } from '$lib/protocol';
import { climbCard, secondsToTop } from './climb-card';
import { classedOf, climbsOf } from './climbs';
import { legsRoad } from './fixtures';
import { steadySpeed } from './pace';

// The synthetic fixture (#3089): a kilometre flat, two at 5 %, a flat
// kilometre, three at 6 %, a flat finish — two classed climbs.
const ride = legsRoad([1000, 0], [2000, 5], [1000, 0], [3000, 6], [1000, 0]);
const climbs = climbsOf(ride);
const [first, second] = classedOf(climbs);

describe('the climb card opens and closes (#3089)', () => {
	it('opens 500 m before the foot at speed, and no sooner', () => {
		expect(climbCard(ride, climbs, first.startM - 510, 10)).toBeNull();
		expect(climbCard(ride, climbs, first.startM - 490, 10)?.n).toBe(1);
	});

	it('opens 60 s before the foot for a rider slower than that', () => {
		// 5 m/s: 60 s is 300 m, later than 500 m.
		expect(climbCard(ride, climbs, first.startM - 400, 5)).toBeNull();
		expect(climbCard(ride, climbs, first.startM - 290, 5)?.n).toBe(1);
	});

	it('stays 200 m past the top, summited, then closes', () => {
		const over = climbCard(ride, climbs, first.topM + 150, 10);
		expect(over?.summited).toBe(true);
		expect(over?.toTopM).toBe(0);
		expect(climbCard(ride, climbs, first.topM + 250, 10)).toBeNull();
	});
});

describe('the four fields on a synthetic fixture (#3089)', () => {
	it('reads to the top, ascent left, average % left and grade now', () => {
		const m = first.startM + 500;
		const card = climbCard(ride, climbs, m, 8);
		expect(card).toMatchObject({ cls: first.cls, n: 1, of: 2 });
		expect(card!.nextInM).toBeCloseTo(second.startM - m, 5);
		expect(card!.toTopM).toBeCloseTo(first.topM - m, 5);
		expect(card!.ascentLeftM).toBeCloseTo(0.05 * (first.topM - m), 5);
		expect(card!.avgLeftPct).toBeCloseTo(5, 5);
		expect(card!.grade).toBeCloseTo(5, 5);
		expect(card!.flammeRouge).toBe(false);
	});

	it('counts a flat run-in into the average still to climb', () => {
		const card = climbCard(ride, climbs, first.startM - 250, 10);
		expect(card!.grade).toBeCloseTo(0, 5);
		expect(card!.ascentLeftM).toBeCloseTo(first.gainM, 1);
		expect(card!.avgLeftPct).toBeLessThan(5);
	});

	it('flies the flamme rouge inside the last kilometre', () => {
		expect(climbCard(ride, climbs, first.topM - 1000, 8)!.flammeRouge).toBe(
			true,
		);
		expect(climbCard(ride, climbs, first.topM - 1001, 8)!.flammeRouge).toBe(
			false,
		);
	});

	it('names no next climb on the last one', () => {
		expect(
			climbCard(ride, climbs, second.startM + 10, 8)!.nextInM,
		).toBeUndefined();
	});
});

describe('time to the top from the pace model (#3089)', () => {
	const mass = 75 + 8;

	it('sums each stretch at the speed its own grade allows', () => {
		// 200 m of flat run-in, then the whole climb at 5 %.
		const want =
			200 / steadySpeed(250, 0, mass, PaceDefaultCdA) +
			(first.topM - first.startM) / steadySpeed(250, 5, mass, PaceDefaultCdA);
		expect(
			secondsToTop(ride, first.startM - 200, first.topM, 250, mass),
		).toBeCloseTo(want, 3);
	});

	it('has nothing to say with no power', () => {
		expect(secondsToTop(ride, first.startM, first.topM, 0, mass)).toBeNull();
	});
});
