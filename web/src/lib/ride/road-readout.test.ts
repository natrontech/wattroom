import { describe, expect, it } from 'vitest';
import { climbsOf } from '$lib/road/climbs';
import { legsRoad } from '$lib/road/fixtures';
import { roadReadout } from '$lib/road/readout';
import { turnedRound } from '$lib/road/road';
import { createRoadReadout, roadLine } from './road-readout';

// A synthetic ride (#3060's): a kilometre flat, two at 5 %, a flat
// kilometre, three at 6 %, a flat finish.
const ride = legsRoad([1000, 0], [2000, 5], [1000, 0], [3000, 6], [1000, 0]);

describe('a ride’s road readout (#3639)', () => {
	it('reads the road as ridden: up it, and turned round on a lap back', () => {
		const at = createRoadReadout();
		expect(at(ride, 1300)).toEqual(roadReadout(ride, climbsOf(ride), 1300));
		const back = turnedRound(ride);
		// 1.3 km along the stored road, ridden back, is 6.7 km from its far end.
		expect(at(ride, 1300, true)).toEqual(
			roadReadout(back, climbsOf(back), 6700),
		);
		// Ridden back, that stretch of the 5 % climb is a descent.
		expect(at(ride, 1300, true).grade).toBeCloseTo(-5, 5);
	});

	it('says it as slot 1 reads it, the top only on a classed climb', () => {
		expect(
			roadLine({ grade: 7.62, km: 12.44, totalKm: 52.9, toTopM: 3240 }),
		).toBe('km 12.4 of 52.9 · 7.6 % · top in 3.2 km');
		expect(roadLine({ grade: 0, km: 0.4, totalKm: 8 })).toBe(
			'km 0.4 of 8.0 · 0.0 %',
		);
	});
});
