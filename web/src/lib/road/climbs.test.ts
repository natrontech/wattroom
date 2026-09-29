import { describe, expect, it } from 'vitest';
import {
	MAX_CLIMBS,
	classOf,
	climbsOf,
	hairpinsOf,
	type Climb,
} from './climbs';
import {
	HAIRPINS,
	bridgeAndTunnel,
	hairpinClimb,
	spiky,
	switchback,
} from './fixtures';
import type { Road } from './road';
import { toRoute } from './route';

const STEP = 20;

/** A road drawn as legs of [metres, percent], a sample every 20 m, no turns. */
function road(...legs: [number, number][]): Road {
	const heights = [500];
	for (const [metres, pct] of legs)
		for (let s = 0; s < metres; s += STEP)
			heights.push(heights[heights.length - 1] + (pct / 100) * STEP);
	return {
		length: STEP * (heights.length - 1),
		heights,
		turns: new Array(heights.length - 1).fill(0),
	};
}

const summary = (cs: Climb[]) =>
	cs.map((c) => [c.startM, c.topM, Math.round(c.gainM), c.cls]);

describe('climbsOf, SPEC’s rule', () => {
	it.each([
		[
			'exactly 500 m at 3 %: a climb, without a chip',
			[[500, 3]],
			[[0, 500, 15, null]],
		],
		['480 m at 3.2 %: too short', [[480, 3.2]], []],
		['600 m at 2.9 %: too gentle', [[600, 2.9]], []],
		['2 km at 6 %: class IV', [[2000, 6]], [[0, 2000, 120, 'IV']]],
	] as [string, [number, number][], unknown[]][])('%s', (_, legs, want) => {
		expect(summary(climbsOf(road(...legs)))).toEqual(want);
	});

	it('bridges a dip that loses under 20 m and is back over the top within 300 m', () => {
		// Down 15 m over 100 m, and back over the top 150 m later.
		const r = road([1000, 6], [100, -15], [1000, 10]);
		expect(summary(climbsOf(r))).toEqual([[0, 2100, 145, 'IV']]);
	});

	it('ends a climb at a dip that loses 20 m or more', () => {
		const r = road([1000, 6], [100, -25], [1000, 6]);
		expect(climbsOf(r).map((c) => c.topM)).toEqual([1000, 2100]);
	});

	it('ends a climb at a dip that lasts 300 m or more', () => {
		const r = road([1000, 6], [100, -5], [300, 0], [1000, 6]);
		expect(climbsOf(r)).toHaveLength(2);
	});

	// The road drops 10 m below where it started rising, and is back over
	// that first rise within 300 m: a dip small enough to bridge. The climb's
	// foot is still the lower floor, not the first rise.
	it('starts at the lowest floor before the rise', () => {
		const r = road([200, 2.5], [100, -10], [2000, 7]);
		expect(summary(climbsOf(r))).toEqual([[300, 2300, 140, 'IV']]);
	});

	// A 3 km run-in at 1 % would dilute the ramp below 3 % if the climb had to
	// start at the valley floor; it starts where its average still holds.
	it('starts where the average holds, not at the foot of a long run-in', () => {
		const [climb] = climbsOf(road([3000, 1], [800, 8]));
		expect(climb.topM).toBe(3800);
		expect(
			climb.gainM / ((climb.topM - climb.startM) / 100),
		).toBeGreaterThanOrEqual(3);
		expect(climb.startM).toBeLessThan(3000);
	});

	it('keeps the hardest 32 when a road has more, in road order', () => {
		const legs: [number, number][] = [];
		for (let k = 0; k < 40; k++) legs.push([600 + 20 * k, 4], [600, -4]);
		const cs = climbsOf(road(...legs));
		expect(cs).toHaveLength(MAX_CLIMBS);
		// The eight shortest were the first eight.
		expect(cs[0].startM).toBeGreaterThan(8 * 1200);
		const starts = cs.map((c) => c.startM);
		expect(starts).toEqual([...starts].sort((a, b) => a - b));
	});
});

describe('classOf', () => {
	it.each([
		[8000, null],
		[8000.01, 'IV'],
		[16000, 'IV'],
		[16000.01, 'III'],
		[32000.01, 'II'],
		[64000.01, 'I'],
		[80000, 'I'],
		[80000.01, 'HC'],
	] as const)(
		'scores %d as %s — each class is above its floor',
		(score, cls) => {
			expect(classOf(score)).toBe(cls);
		},
	);
});

describe('the synthetic roads', () => {
	it.each([
		['the 21-hairpin climb', 1, HAIRPINS, hairpinClimb],
		['the switchback', 1, 1, switchback],
		['the 2 % road under the bridge and tunnel', 0, 0, bridgeAndTunnel],
		['the flat road with GPS spikes', 0, 0, spiky],
	] as const)('%s: %d climb(s), %d hairpin(s)', (_, climbs, pins, points) => {
		const r = toRoute(points());
		expect(r.climbs).toHaveLength(climbs);
		expect(hairpinsOf(r.road)).toHaveLength(pins);
	});

	it('tops the hairpin climb out at its own summit, classed by its gain', () => {
		const r = toRoute(hairpinClimb());
		const [climb] = r.climbs;
		expect(climb.topM).toBeCloseTo(r.length, -2);
		expect(climb.gainM).toBeCloseTo(r.maxEle - r.minEle, 0);
		expect(climb.cls).toBe('II');
	});
});
