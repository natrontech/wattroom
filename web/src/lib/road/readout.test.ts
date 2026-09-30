import { describe, expect, it } from 'vitest';
import { climbsOf } from './climbs';
import { roadReadout } from './readout';
import type { Road } from './road';

const STEP = 20;

/** A road drawn as legs of [metres, percent], a sample every 20 m, no turns. */
function road(...legs: [number, number][]): Road {
	const heights = [500];
	for (const [metres, pct] of legs)
		for (let s = 0; s < metres; s += STEP)
			heights.push(heights[heights.length - 1] + (pct / 100) * STEP);
	return {
		length: STEP * (heights.length - 1),
		heights,
		turns: new Array(heights.length - 1).fill(0),
	};
}

// A synthetic ride (#3060): a kilometre flat, two kilometres at 5 %, a flat
// kilometre, three at 6 %, and a flat finish — two classed climbs.
const ride = road([1000, 0], [2000, 5], [1000, 0], [3000, 6], [1000, 0]);
const climbs = climbsOf(ride);
const classed = climbs.filter((c) => c.cls);

describe('the road readout every surface says (#3060)', () => {
	it('draws two classed climbs out of the synthetic ride', () => {
		expect(classed).toHaveLength(2);
	});

	it('on the flat before the first climb: no top to count down to', () => {
		const r = roadReadout(ride, climbs, 400);
		expect(r.grade).toBeCloseTo(0, 5);
		expect(r.km).toBeCloseTo(0.4, 5);
		expect(r.totalKm).toBeCloseTo(8, 5);
		expect(r.toTopM).toBeUndefined();
		expect(r.climb).toBeUndefined();
		// The next 2 km: 600 m of flat, then the climb's 5 %.
		expect(r.ahead).toHaveLength(20);
		expect(r.ahead!.slice(0, 6).every((g) => Math.abs(g) < 1e-9)).toBe(true);
		expect(r.ahead!.slice(6).every((g) => Math.abs(g - 5) < 1e-9)).toBe(true);
	});

	it('on a climb: the grade now, the top in, and which climb of how many', () => {
		const [first, second] = classed;
		const m = first.startM + 300;
		const r = roadReadout(ride, climbs, m);
		expect(r.grade).toBeCloseTo(5, 5);
		expect(r.toTopM).toBeCloseTo(first.topM - m, 5);
		expect(r.climb).toEqual({ cls: first.cls, n: 1, of: 2 });

		const up = roadReadout(ride, climbs, second.topM - 50);
		expect(up.toTopM).toBeCloseTo(50, 5);
		expect(up.climb).toEqual({ cls: second.cls, n: 2, of: 2 });
	});

	it('past a climb’s top, no longer on it', () => {
		const r = roadReadout(ride, climbs, classed[0].topM + 1);
		expect(r.climb).toBeUndefined();
		expect(r.toTopM).toBeUndefined();
	});

	it('counts fewer bars in the road’s last 2 km, and none in its last 100 m', () => {
		expect(roadReadout(ride, climbs, ride.length - 750).ahead).toHaveLength(7);
		expect(roadReadout(ride, climbs, ride.length - 50).ahead).toBeUndefined();
	});

	it('clamps a metre past either end to the road', () => {
		expect(roadReadout(ride, climbs, -10).km).toBe(0);
		expect(roadReadout(ride, climbs, ride.length + 10).km).toBeCloseTo(8, 5);
	});
});
