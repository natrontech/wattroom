import { describe, expect, it } from 'vitest';
import { scoredTarget } from './types';

describe('scoredTarget', () => {
	it('puts the rider on their own trim, as the hub scores them', () => {
		expect(scoredTarget(200, { bias: 0.9 })).toBe(180);
	});

	it('reads a missing or unset trim as the plan itself', () => {
		expect(scoredTarget(200)).toBe(200);
		expect(scoredTarget(200, { bias: 0 })).toBe(200);
	});

	it('has no target while the guard has released it', () => {
		expect(scoredTarget(200, { bias: 1, released: true })).toBe(0);
	});
});
