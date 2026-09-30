import { beforeAll, describe, expect, it } from 'vitest';
import { toRoute, type Route } from '$lib/road/route';
import { generate, type World } from './world';
import {
	folds,
	longLoopPoints,
	worstRiseThroughRoad,
} from './world.test-helper';

/**
 * A long loop once built coarse cells wide enough that the far corners of a
 * fine chunk lay beyond the road index's search: 533 faces steeper than 58°.
 * The ground is on the world lattice now (#3075), 40 and 10 m whatever the
 * route, and this loop keeps it honest over 124 km. Its own file, so it
 * builds beside world.test.ts rather than after it.
 */

let route: Route;
let world: World;
beforeAll(() => {
	route = toRoute(longLoopPoints());
	world = generate(route);
}, 30_000);

describe('a world around a 124 km loop', () => {
	it('draws on the lattice however long the route: every vertex 10 or 40 m from the next', () => {
		expect(route.loop).toBe(true);
		expect(route.length).toBeGreaterThan(100_000);
		const { pos } = world.mesh;
		let off = 0;
		for (let k = 0; k < pos.length; k += 3)
			if (pos[k] % 10 !== 0 || pos[k + 2] % 10 !== 0) off++;
		expect(pos.length).toBeGreaterThan(0);
		expect(off).toBe(0);
	});

	it('folds no terrain face into a wall steeper than 58°', () => {
		expect(folds(world)).toBe(0);
	});

	it('never lifts the ground through the road', () => {
		expect(worstRiseThroughRoad(route, world)).toBeLessThan(0.2);
	});
});
