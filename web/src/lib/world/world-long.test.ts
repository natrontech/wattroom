import { beforeAll, describe, expect, it } from 'vitest';
import { toRoute, type Route } from '$lib/road/route';
import { generate, type World } from './world';
import {
	folds,
	longLoopPoints,
	worstRiseThroughRoad,
} from './world.test-helper';

/**
 * A long loop builds coarse cells wide enough that the far corners of a fine
 * chunk lie beyond the road index's search. Those vertices once took the
 * route's first sample as their road height, and the coarse vertex a fraction
 * of a row along as their distance: this loop drew 533 faces steeper than
 * 58°, and either half of the fix alone still drew about 480. Its own file,
 * so it builds beside world.test.ts rather than after it.
 */

let route: Route;
let world: World;
beforeAll(() => {
	route = toRoute(longLoopPoints());
	world = generate(route);
}, 30_000);

describe('a world around a 124 km loop', () => {
	it('is long enough that fine terrain reaches past the road index', () => {
		expect(route.loop).toBe(true);
		expect(route.length).toBeGreaterThan(100_000);
		// A fine chunk spans 4 cells; past ~70 m its far corner is > 480 m out.
		expect(world.cell).toBeGreaterThan(70);
	});

	it('folds no terrain face into a wall steeper than 58°', () => {
		expect(folds(world)).toBe(0);
	});

	it('never lifts the ground through the road', () => {
		expect(worstRiseThroughRoad(route, world)).toBeLessThan(0.2);
	});
});
