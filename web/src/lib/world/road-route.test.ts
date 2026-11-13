import { describe, expect, it } from 'vitest';
import { at, closes } from '#lib/road/along.ts';
import { heightAt } from '#lib/road/at-metre.ts';
import {
	alpineLoop,
	HAIRPINS,
	hairpinClimb,
	legsRoad,
} from '#lib/road/fixtures.ts';
import { toRoute, type Route } from '#lib/road/route.ts';
import type { Road } from '#lib/road/road.ts';
import { HOME_ROADS, homeRoute } from '#lib/ride/home-roads.ts';
import { walk } from './place/stroke';
import { closeHeights, closeWalk, routeOfRoad } from './road-route';

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
 * Carried, they still left the Pass loop's end 25 m beside its start, and a
 * voice channel's free ride, standing at its start before the first pedal
 * stroke, looked at a road broken in pieces.
 */
describe('a walked loop', () => {
	const gap = (r: Route) => {
		const n = r.x.length - 1;
		return Math.hypot(r.x[n] - r.x[0], r.z[n] - r.z[0]);
	};

	it.each(HOME_ROADS.map((r) => [r.name, r] as const))(
		'%s ends on its start, and its world goes round it',
		async (_, home) => {
			const { road, loop } = await homeRoute(home);
			expect(loop).toBe(true);
			const walked = routeOfRoad(road);
			expect(gap(walked)).toBeLessThan(0.01);
			// Ridden round, as the ride's world rides it (compose.ts).
			const round = { ...walked, loop: true };
			expect(closes(round)).toBe(true);
			// Across the seam a rider moves the metres it rode, never a jump.
			const before = at(round, round.length - 2);
			const after = at(round, 2);
			expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(
				4.5,
			);
		},
	);

	it('moves no metre of the road further than its ends lay apart', async () => {
		const { road } = await homeRoute(HOME_ROADS[0]);
		const open = walk(road);
		const n = open.x.length - 1;
		const apart = Math.hypot(open.x[n] - open.x[0], open.z[n] - open.z[0]);
		expect(apart).toBeGreaterThan(1);
		const x = open.x.slice();
		const z = open.z.slice();
		closeWalk(x, z, road.length);
		let most = 0;
		for (let k = 0; k <= n; k++)
			most = Math.max(most, Math.hypot(x[k] - open.x[k], z[k] - open.z[k]));
		expect(most).toBeLessThanOrEqual(apart + 1e-6);
		expect(Math.hypot(x[n] - x[0], z[n] - z[0])).toBeLessThan(1e-6);
	});

	it('keeps a road with two ends open: a lap starts again where it began', () => {
		const walked = routeOfRoad(alpineLoop());
		expect(gap(walked)).toBeGreaterThan(1000);
		expect(closes({ ...walked, loop: true })).toBe(false);
	});
});

/**
 * A loop's barometer drifts: a ride recorded 10 m higher home than out drew
 * its last metre as a ramp into the bank over its first, the start arch
 * buried in it. The drawn road ends at the height it began at.
 */
describe('a loop recorded higher home than out', () => {
	it('is drawn level where its ends meet, its grades all but as ridden', async () => {
		const { road } = await homeRoute(HOME_ROADS[0]);
		const n = road.heights.length - 1;
		const drifted: Road = {
			...road,
			heights: road.heights.map((h, i) => h + (10 * i) / n),
		};
		const was = routeOfRoad(road);
		const drawn = routeOfRoad(drifted);
		const last = drawn.ele.length - 1;
		expect(drawn.ele[last]).toBeCloseTo(drawn.ele[0], 6);
		// Half up at the start, half down at the end.
		expect(drawn.ele[0] - was.ele[0]).toBeCloseTo(5, 1);
		// The ride's own grades stay the file's.
		expect(drawn.grade).toEqual(routeOfRoad(drifted, false).grade);
		expect(drawn.length).toBe(road.length);
	});

	it('leaves heights that meet as they are', () => {
		const ele = Float64Array.from([5, 7, 9, 7, 5]);
		expect(closeHeights(ele)).toBe(ele);
	});

	it('leaves a road with two ends its climb', () => {
		const climb = routeOfRoad(legsRoad([2000, 6]));
		expect(climb.ele[climb.ele.length - 1] - climb.ele[0]).toBeGreaterThan(100);
	});
});

/**
 * A hairpin is drawn as tight as it is (#4258): smoothing the heading again
 * after the import drew each wider, and 21 of them stacked their legs
 * hundreds of metres up the hill — legs 20 m apart stood 60 m apart.
 */
describe('a walked hairpin climb', () => {
	it('stands each leg as far from the next as the climb does', () => {
		const real = toRoute(hairpinClimb());
		const walked = routeOfRoad(real.road);
		// About each leg's middle: 300 m legs, each hairpin half a 10 m-radius circle.
		const middle = (k: number) => 150 + k * (300 + Math.PI * 10);
		const apart = (r: Route, k: number) => {
			const p = at(r, middle(k));
			const q = at(r, middle(k + 1));
			return Math.hypot(p.x - q.x, p.z - q.z);
		};
		// Within 15 m at every leg; smoothed again, they stood about 54 m wider.
		for (let k = 0; k < HAIRPINS; k++)
			expect(
				Math.abs(apart(walked, k) - apart(real, k)),
				`legs ${k} and ${k + 1}`,
			).toBeLessThan(15);
	});
});
