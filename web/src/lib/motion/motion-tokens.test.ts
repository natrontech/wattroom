import { describe, expect, it } from 'vitest';
import { pop } from './damp';
import { bezier, EASE } from './tokens';

describe('the curves script uses', () => {
	it('solves cubic-bezier() the way CSS does', () => {
		const straight = bezier([1 / 3, 1 / 3, 2 / 3, 2 / 3]);
		for (const x of [0.1, 0.37, 0.8]) expect(straight(x)).toBeCloseTo(x, 4);
		// CSS `ease` at half time, the figure every implementation agrees on.
		expect(bezier([0.25, 0.1, 0.25, 1])(0.5)).toBeCloseTo(0.8024, 3);
		expect(bezier(EASE.arrive)(0)).toBe(0);
		expect(bezier(EASE.leave)(1)).toBe(1);
	});

	it('springs the pop to SPEC’s 8 % overshoot and lands on 1', () => {
		const samples = Array.from({ length: 1001 }, (_, i) => pop(i / 1000));
		expect(samples[0]).toBe(0);
		expect(samples[1000]).toBe(1);
		expect(Math.max(...samples)).toBeGreaterThan(1.07);
		expect(Math.max(...samples)).toBeLessThan(1.09);
	});
});
