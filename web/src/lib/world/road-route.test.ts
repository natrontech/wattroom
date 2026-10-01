import { describe, expect, it } from 'vitest';
import { at } from '$lib/road/along';
import { heightAt } from '$lib/road/at-metre';
import { legsRoad } from '$lib/road/fixtures';
import type { Road } from '$lib/road/road';
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
