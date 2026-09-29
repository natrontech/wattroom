import { describe, expect, it } from 'vitest';
import type { Workout } from '$lib/workout/types';
import { matchTerrain } from './match';
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

const steady = (minutes: number, target: number) =>
	({ type: 'steady', seconds: minutes * 60, target }) as const;

/** 2 × 20 min, with a warm-up, a recovery and a cool-down. */
const twoByTwenty: Workout = {
	name: '2 × 20',
	steps: [
		steady(10, 0.55),
		steady(20, 0.95),
		steady(5, 0.55),
		steady(20, 0.95),
		steady(10, 0.5),
	],
};

// 40 km of flat before one 8 % climb and its descent: from km 0 the whole
// workout stays on the flat, where the targets follow nothing.
const climbAndDescent = road([40_000, 0], [8_000, 8], [8_000, -8], [10_000, 0]);

describe('matchTerrain', () => {
	it('lands a 2 × 20 on the climb, where km 0 lands it on nothing', () => {
		const { best, fromZero, suggestRoad } = matchTerrain(
			climbAndDescent,
			twoByTwenty,
		);
		expect(fromZero.corr).toBeLessThanOrEqual(0.1);
		expect(best.corr).toBeGreaterThanOrEqual(0.4);
		expect(suggestRoad).toBe(false);
		// It starts on the flat before the climb, ridden forward, or before
		// the descent's foot ridden back — the same hill either way.
		const climbFoot = best.reverse ? 10_000 : 40_000;
		expect(best.startM).toBeGreaterThan(climbFoot - 15_000);
		expect(best.startM).toBeLessThan(climbFoot);
	});

	it('suggests the road workout when no start follows the terrain', () => {
		const flat = road([30_000, 0]);
		const { best, suggestRoad } = matchTerrain(flat, twoByTwenty);
		expect(best.corr).toBe(0);
		expect(suggestRoad).toBe(true);
	});

	it('counts the time spent crawling against a start', () => {
		// A wall the recovery crawls up at 55 %: the slow share is priced in.
		const wall = road([2_000, 0], [20_000, 14], [20_000, 0]);
		const { fromZero } = matchTerrain(wall, twoByTwenty);
		expect(fromZero.slow).toBeGreaterThan(0.3);
		expect(fromZero.score).toBeCloseTo(fromZero.corr - 0.3 * fromZero.slow, 10);
	});
});
