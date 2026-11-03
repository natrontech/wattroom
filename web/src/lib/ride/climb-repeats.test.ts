import { describe, expect, it } from 'vitest';
import { legsRoad } from '$lib/road/fixtures';
import { turnedRound } from '$lib/road/road';
import { climbedStep } from './climbed';
import { EVEREST_M, repeatsLine, wayUp } from './climb-repeats';
import { feltGrade } from './ride-grade';
import { createRoadLaps } from './road-ride';

// A made-up 2 km climb at 10 %: 200 m a repeat.
const climb = legsRoad([2000, 10]);
const kg = () => 75;

describe('the way up for climb repeats (#3193)', () => {
	it('is the way that climbs more, and a loop or a flat road has none', () => {
		expect(wayUp(climb)).toBe(false);
		expect(wayUp(turnedRound(climb))).toBe(true);
		expect(wayUp(climb, true)).toBeNull();
		expect(wayUp(legsRoad([2000, 0]))).toBeNull();
	});
});

describe('climb repeats (#3193)', () => {
	it('climbs to Everest on a fixture: up, down at 0 % felt, and up again', () => {
		const laps = createRoadLaps(climb, { kg });
		laps.repeats = wayUp(climb);
		let climbed = 0;
		let last = laps.start();
		let downFor = 0;
		for (let s = 0; climbed < EVEREST_M; s++) {
			expect(s, 'never reached Everest').toBeLessThan(200_000);
			const here = laps.second(300, s * 1000);
			climbed += climbedStep(climb, last.m, here.m);
			last = here;
			downFor = laps.reverse ? downFor + 1 : 0;
			// The descent is felt flat once the 1 %/s slew has come down from
			// the climb's own felt grade.
			if (downFor > 6) expect(here.felt).toBe(0);
			// The dot never waits at an end for a pick: repeats turn by themselves.
			expect(here.atEnd).toBe(false);
		}
		expect(climbed).toBeGreaterThanOrEqual(EVEREST_M);
		// 200 m a repeat: the 45th top passes 8,849 m.
		expect(laps.ascents).toBe(44);
		expect(climbed).toBeCloseTo(44 * 200 + last.alt - 500, 0);
	});

	it('rides the climb itself at its felt grade', () => {
		const laps = createRoadLaps(climb, { kg });
		laps.repeats = false;
		let here = laps.start();
		for (let s = 0; s < 60; s++) here = laps.second(300, s * 1000);
		expect(here.felt).toBeCloseTo(feltGrade(10), 9);
	});

	it('stops at the end as before when off, and never repeats a loop', () => {
		const off = createRoadLaps(climb, { kg, from: 1990 });
		let here = off.start();
		for (let s = 0; s < 30; s++) here = off.second(300, s * 1000);
		expect(here.atEnd).toBe(true);
		const loop = createRoadLaps(climb, { kg, loop: true });
		loop.repeats = false;
		expect(loop.repeats).toBeNull();
	});

	it('reads the metres against Everest, in the app’s thousands', () => {
		expect(repeatsLine(1234.4, 1)).toBe('1,234 of 8,849 m climbed · 1 ascent');
		expect(repeatsLine(8849, 44)).toBe('8,849 of 8,849 m climbed · 44 ascents');
	});
});
