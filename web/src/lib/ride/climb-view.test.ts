import { describe, expect, it } from 'vitest';
import type { Road } from '$lib/road/road';
import { BAR_M, climbView } from './climb-view';

/** Flat for 2 km, then 1.5 km at 8 %, then flat again: one classed climb. */
const heights = [
	...Array(101).fill(500),
	...Array.from({ length: 75 }, (_, i) => 500 + (i + 1) * 1.6),
	...Array(100).fill(620),
];
const road: Road = {
	length: (heights.length - 1) * 20,
	heights,
	turns: heights.slice(1).map(() => 0),
};
const view = (m: number, reverse = false) => ({ road, m, mps: 8, reverse });

describe('the climb card as a surface reads it (#3645)', () => {
	it('is nothing far from a climb', () => {
		expect(climbView(view(200), 250, 75)).toBeNull();
		expect(climbView(null, 250, 75)).toBeNull();
	});

	it('opens before the foot, and counts down to it', () => {
		const card = climbView(view(1700), 250, 75)!;
		expect(card.card.cls).not.toBeNull();
		expect(card.toFootM).toBeCloseTo(card.climb.startM - 1700, 6);
		expect(card.toFootM).toBeGreaterThan(0);
	});

	it('draws the climb in 100 m bars, foot to top, each in its grade step', () => {
		const card = climbView(view(2400), 250, 75)!;
		expect(card.toFootM).toBe(0);
		const { startM, topM } = card.climb;
		expect(card.bars[0].fromM).toBe(startM);
		expect(card.bars.at(-1)!.toM).toBe(topM);
		for (const bar of card.bars.slice(0, -1))
			expect(bar.toM - bar.fromM).toBe(BAR_M);
		// 8 % is the third step (6–9 %).
		expect(card.bars.slice(1, -1).every((b) => b.step === 2)).toBe(true);
		expect(card.lo).toBeLessThan(card.hi);
		expect(card.heightNow).toBeGreaterThanOrEqual(card.lo);
	});

	it('times the top at the last 30 s, and not without power', () => {
		expect(climbView(view(2400), 250, 75)!.secondsToTop).toBeGreaterThan(0);
		expect(climbView(view(2400), 0, 75)!.secondsToTop).toBeNull();
	});

	it('reads a lap ridden back as the road that lap rides', () => {
		// Back down from the far end: the climb is a descent, so no card.
		expect(climbView(view(road.length - 3000, true), 250, 75)).toBeNull();
	});
});
