import { describe, expect, it } from 'vitest';
import { heightAt } from '#lib/road/at-metre.ts';
import { toRoute } from '#lib/road/route.ts';
import {
	bareAt,
	crossingsOf,
	LEVEL_UP_TO_M,
	levelCrossings,
} from './crossings';
import { eight } from './eight';
import { routeOfRoad } from './road-route';
import { syntheticPoints } from './synthetic';

const drawn = (rise: number) =>
	routeOfRoad(toRoute(syntheticPoints(eight(rise))).road);
/** The same road as recorded: two passes, two heights. */
const recorded = (rise: number) => {
	const route = drawn(rise);
	const road = route.road!;
	return {
		...route,
		ele: Float64Array.from(route.ele, (_, i) =>
			heightAt(road, Math.min(i * route.step, road.length)),
		),
	};
};

describe('where a route crosses itself', () => {
	it('finds the one crossing of a figure of eight, square enough and level', () => {
		const found = crossingsOf(drawn(0));
		expect(found).toHaveLength(1);
		const [c] = found;
		expect(c.b - c.a).toBeGreaterThan(1000);
		expect(c.angle).toBeGreaterThan(45);
		expect(Math.abs(c.rise)).toBeLessThan(1.5);
	});

	it('says how far one pass runs over the other', () => {
		const [c] = crossingsOf(recorded(8));
		expect(Math.abs(c.rise)).toBeGreaterThan(5);
		expect(Math.abs(c.rise)).toBeLessThan(9);
	});

	it('finds none on a loop that only closes, hairpins and all', () => {
		expect(crossingsOf(routeOfRoad(toRoute(syntheticPoints()).road))).toEqual(
			[],
		);
	});
});

describe('a crossing as the world draws it', () => {
	it('meets at one height, each pass eased there by half the difference', () => {
		const before = recorded(8);
		const [was] = crossingsOf(before);
		const route = drawn(8);
		const [c] = crossingsOf(route);
		expect(Math.abs(c.rise)).toBeLessThan(0.05);
		const i = Math.round(c.a / route.step);
		expect(Math.abs(route.ele[i] - before.ele[i])).toBeCloseTo(
			Math.abs(was.rise) / 2,
			0,
		);
		// Eased: no sample moves the drawn grade more than 3 % off the ridden one.
		let worst = 0;
		for (let k = 1; k < route.ele.length; k++) {
			const moved =
				route.ele[k] - before.ele[k] - (route.ele[k - 1] - before.ele[k - 1]);
			worst = Math.max(worst, Math.abs(moved / route.step) * 100);
		}
		expect(worst).toBeLessThan(3.1);
	});

	it('keeps the ride its own grades: only the drawn heights move', () => {
		const route = drawn(8);
		const road = route.road!;
		expect(route.length).toBe(road.length);
		expect(Math.max(...route.grade.map(Math.abs))).toBeLessThan(4);
	});

	it('is bare asphalt through the crossing on both passes, and nowhere else', () => {
		const route = drawn(0);
		const [c] = crossingsOf(route);
		expect(bareAt(route, c.a)).toBe(1);
		expect(bareAt(route, c.b)).toBe(1);
		expect(bareAt(route, c.a + 60)).toBe(0);
		expect(bareAt(route, 0)).toBe(0);
	});

	it('leaves a road high over another as recorded', () => {
		const high = { ...recorded(8) };
		const [c] = crossingsOf(high);
		const from = Math.round(c.b / high.step) - 5;
		for (let i = from; i < from + 10; i++)
			high.ele[i] += Math.sign(c.rise) * (LEVEL_UP_TO_M + 5);
		expect(levelCrossings(high)).toBeNull();
	});

	it('leaves a route that never crosses itself untouched', () => {
		const route = routeOfRoad(toRoute(syntheticPoints()).road);
		expect(route.bare).toBeUndefined();
	});
});
