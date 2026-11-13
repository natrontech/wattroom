import { describe, expect, it } from 'vitest';
import { heightAt } from '#lib/road/at-metre.ts';
import { homeStreet, outAndBack } from '#lib/road/fixtures.ts';
import { toRoute } from '#lib/road/route.ts';
import {
	CLEAR_M,
	JOINED,
	JOINS,
	meetingAt,
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
		expect(Math.abs(c.rise)).toBeGreaterThan(0);
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

	it('knows how far each pass lies off the other through the crossing, and nowhere else', () => {
		const route = drawn(0);
		const [c] = crossingsOf(route);
		// On the crossing a pass's centre is on the other's.
		expect(meetingAt(route, c.a, c.x, c.z)[0]).toBeLessThan(0.5);
		expect(meetingAt(route, c.b, c.x, c.z)[0]).toBeLessThan(0.5);
		// Along one pass, the other's centre line falls behind either way.
		const i = Math.floor(c.a / route.step);
		const hx = route.x[i + 1] - route.x[i];
		const hz = route.z[i + 1] - route.z[i];
		const len = Math.hypot(hx, hz);
		const off = (m: number) =>
			meetingAt(route, c.a, c.x + (hx / len) * m, c.z + (hz / len) * m)[0];
		expect(off(3)).toBeGreaterThan(1.5);
		expect(off(3)).toBeLessThanOrEqual(3);
		expect(off(-3)).toBeCloseTo(off(3), 0);
		// Away from it the paint is the road's own.
		expect(meetingAt(route, c.a + 60, c.x, c.z)[0]).toBe(CLEAR_M);
		expect(meetingAt(route, 0, route.x[0], route.z[0])[0]).toBe(CLEAR_M);
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

/**
 * A street ridden twice is one road (shared-road.ts), and where the later
 * pass comes onto it or leaves it, a road joining a road. The later pass's
 * line lies on the earlier one's there and touched it a sample at a time:
 * each touch read as a crossing, and the whole street was drawn bare.
 */
describe('a street ridden twice', () => {
	const street = routeOfRoad(toRoute(outAndBack()).road);
	const home = routeOfRoad(toRoute(homeStreet()).road);

	it('never crosses itself along it', () => {
		expect(crossingsOf(street)).toEqual([]);
		expect(crossingsOf(home)).toEqual([]);
		// Its line alone, not known to be drawn on the earlier pass, touches it.
		expect(crossingsOf({ ...home, shared: undefined })).not.toEqual([]);
	});

	it('meets itself only where the later pass joins the street or leaves it', () => {
		const meetings = home.bare ?? [];
		expect(meetings.length).toBeGreaterThan(0);
		expect(meetings.length % 2).toBe(0);
		for (const [from, to, , , as] of meetings) {
			expect([JOINS, JOINED]).toContain(as);
			// A join, not the street: a few hundred metres at the most.
			expect(to - from).toBeLessThan(400);
			// The later pass eases there: neither on the street yet nor clear of it.
			if (as === JOINS) {
				const i = Math.round((from + to) / 2 / home.step);
				expect(home.shared![i]).toBeGreaterThan(0);
				expect(home.shared![i]).toBeLessThan(1);
			}
		}
	});

	it('gives way where it joins, and is its own away from it', () => {
		const [from, to, onFrom, onTo] = home.bare!.find((m) => m[4] === JOINS)!;
		const sample = (d: number) => {
			const i = Math.round(d / home.step);
			return meetingAt(home, i * home.step, home.x[i], home.z[i]);
		};
		// Somewhere along the join the later pass's centre is inside the street's formation.
		let nearest = CLEAR_M;
		for (let d = from; d <= to; d += home.step) {
			const [off, as] = sample(d);
			if (off < nearest) nearest = off;
			if (off < CLEAR_M) expect(as).toBe(JOINS);
		}
		expect(nearest).toBeLessThan(2);
		// And the street reads the later pass there as the one joined.
		const mid = Math.round((onFrom + onTo) / 2 / home.step);
		expect(meetingAt(home, mid * home.step, home.x[mid], home.z[mid])[1]).toBe(
			JOINED,
		);
		expect(sample(to + 200)[0]).toBe(CLEAR_M);
	});
});
