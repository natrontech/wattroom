import { describe, expect, it } from 'vitest';
import { at } from '$lib/road/along';
import { heightAt } from '$lib/road/at-metre';
import { legsRoad } from '$lib/road/fixtures';
import type { Road } from '$lib/road/road';
import { HOME_ROADS, homeRoute } from '$lib/ride/home-roads';
import { routeOfRoad } from './road-route';

/** A road's heights and turns become the route its world is built on (#3663). */
describe('the route of a road', () => {
	const road: Road = {
		...legsRoad([1000, 0], [1000, 6]),
		turns: new Array(100).fill(0).map((_, i) => (i >= 40 && i < 58 ? 10 : 0)),
	};
	const route = routeOfRoad(road);

	it('is as long as the road, and as high at every metre', () => {
		expect(route.length).toBe(road.length);
		for (let m = 0; m <= road.length; m += 50)
			expect(at(route, m).ele).toBeCloseTo(heightAt(road, m), 0);
	});

	it('turns where the road does: 180 degrees over its turning stretch', () => {
		const heading = (m: number) => at(route, m).heading;
		const turned = Math.abs(heading(1900) - heading(100)) % (2 * Math.PI);
		expect(turned).toBeCloseTo(Math.PI, 1);
		// Straight before the turn.
		expect(heading(300)).toBeCloseTo(heading(100), 3);
	});
});

/**
 * A walked road closes where its route does: whole-degree turns rounded one
 * by one used to drift a long road by degrees, laying one stretch of it over
 * another (the Pass loop ended 976 m from its start, the Valley loop 271 m).
 */
describe('a walked loop', () => {
	it.each(HOME_ROADS.map((r) => [r.name, r] as const))(
		'%s ends within 1 % of its length of its start',
		async (_, home) => {
			const { road, loop } = await homeRoute(home);
			expect(loop).toBe(true);
			const { x, z } = routeOfRoad(road);
			const n = x.length - 1;
			expect(Math.hypot(x[n] - x[0], z[n] - z[0])).toBeLessThan(
				road.length / 100,
			);
		},
	);
});
