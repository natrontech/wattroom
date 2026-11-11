import { describe, expect, it } from 'vitest';
import { RouteHiddenEndM } from '#lib/protocol.ts';
import { validateWorkout } from '#lib/workout/validate.ts';
import { climbsOf } from './climbs';
import { crewFromM, crewSeconds, rideTogether } from './ride-together';
import { durationSeconds } from '#lib/workout/engine.ts';
import type { Road } from './road';

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

const r = road([2000, 0], [3000, 6], [2000, 0]);
const route = {
	id: 'route-1',
	genName: 'Road · 7.0 km · 180 m',
	road: r,
	climbs: climbsOf(r),
};

describe('rideTogether (#3105)', () => {
	it('rides the whole road as its road workout, named by its generated name', () => {
		const {
			workout,
			route: picked,
			legs,
		} = rideTogether(route, { fromM: 0, toM: 7000 });
		expect(legs).toBe(1);
		expect(workout.name).toBe(route.genName);
		expect(workout.road).toMatchObject({
			routeId: 'route-1',
			fromM: 0,
			toM: 7000,
		});
		expect(workout.road?.stepEndM).toEqual([2000, 5000, 7000]);
		expect(picked).toEqual({ id: 'route-1', fromM: 0 });
		expect(validateWorkout(workout).ok).toBe(true);
	});

	it('rides one climb, from its foot to its top', () => {
		const climb = route.climbs[0];
		const { workout, route: picked } = rideTogether(route, {
			fromM: climb.startM,
			toM: climb.topM,
		});
		expect(workout.road).toMatchObject({
			fromM: climb.startM,
			toM: climb.topM,
		});
		expect(workout.steps).toHaveLength(1);
		// The crew's frame starts at the first sample past the hidden end.
		expect(picked.fromM).toBe(climb.startM - RouteHiddenEndM);
	});

	it('starts a pick inside a hidden end where the crew’s road starts', () => {
		expect(crewFromM(r, 100)).toBe(0);
		expect(crewFromM(r, RouteHiddenEndM + 1000)).toBe(1000);
		expect(crewFromM(r, 6990)).toBeLessThan(7000 - 2 * RouteHiddenEndM);
	});

	it('rides one of WattRoom’s roads whole: it has no hidden ends (#4258)', () => {
		const { route: picked } = rideTogether(
			{ ...route, whole: true },
			{ fromM: 2000, toM: 7000 },
		);
		expect(picked.fromM).toBe(2000);
	});

	// The list, its time filter and the pick read one clock: the crew's pace.
	it('times the whole road at the pace the crew rides it', () => {
		const { workout } = rideTogether(route, { fromM: 0, toM: 7000 });
		expect(crewSeconds(route)).toBe(durationSeconds(workout));
	});
});
