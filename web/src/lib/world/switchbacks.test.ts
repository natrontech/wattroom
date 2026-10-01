import { beforeAll, describe, expect, it } from 'vitest';
import type { Road } from '$lib/road/road';
import type { Route } from '$lib/road/route';
import { routeOfRoad } from './road-route';
import { generate, type World } from './world';
import { BUILD_MS, worstRiseThroughRoad } from './world.test-helper';

/**
 * Stacked switchbacks (#3709): legs closer than their earthworks allow,
 * the design capture's hairpin fixture in a road's own terms — 600 m legs
 * climbing 6.5 %, turned 180° over 100 m, so each leg runs about 60 m from
 * the last and up to 78 m above it at the far end. The ground between
 * them is a wall; it never rises through either road.
 */

function stacked(legs: number): Road {
	const heights = [100];
	const turns: number[] = [];
	for (let leg = 0; leg < legs; leg++) {
		for (let s = 0; s < 30; s++) turns.push(0);
		if (leg < legs - 1)
			for (let s = 0; s < 5; s++) turns.push(leg % 2 ? -36 : 36);
	}
	for (let i = 0; i < turns.length; i++) heights.push(heights[i] + 0.065 * 20);
	return { length: turns.length * 20, heights, turns };
}

let route: Route;
let world: World;
beforeAll(() => {
	route = routeOfRoad(stacked(4));
	world = generate(route);
}, BUILD_MS);

describe('stacked switchbacks', () => {
	it('never lift the ground through a road, even where two legs disagree', () => {
		expect(worstRiseThroughRoad(route, world)).toBeLessThan(0.2);
	});
});
