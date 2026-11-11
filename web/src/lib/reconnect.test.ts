import { describe, expect, it } from 'vitest';
import { RECONNECT_MS, reconnectDelay } from './reconnect';

describe('a dropped socket’s redial waits', () => {
	it('dials at once, then about 1, 2 and 5 s, and 5 s from there on', () => {
		const mid = () => 0.5;
		expect([0, 1, 2, 3, 4, 40].map((n) => reconnectDelay(n, mid))).toEqual([
			0, 1000, 2000, 5000, 5000, 5000,
		]);
	});

	it('spreads every wait after the first a quarter either way, and never the first', () => {
		for (const r of [0, 0.999]) {
			expect(reconnectDelay(0, () => r)).toBe(0);
			for (let n = 1; n < 6; n++) {
				const base = RECONNECT_MS[Math.min(n, RECONNECT_MS.length - 1)];
				const wait = reconnectDelay(n, () => r);
				expect(wait).toBeGreaterThanOrEqual(base * 0.75);
				expect(wait).toBeLessThanOrEqual(base * 1.25);
			}
		}
	});
});
