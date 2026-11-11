import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReattach, REATTACH_MS, reattachDelay } from './reattach';

describe('reattaching a sensor after a dropout (#37)', () => {
	afterEach(() => vi.useRealTimers());

	it('tries at once, then 1, 2 and 5 s, and 5 s from there on', () => {
		expect([0, 1, 2, 3, 4, 50].map(reattachDelay)).toEqual([
			0, 1000, 2000, 5000, 5000, 5000,
		]);
		expect(Math.max(...REATTACH_MS)).toBeLessThanOrEqual(5000);
	});

	it('keeps trying until the link is back, and starts at once again after it was up', async () => {
		vi.useFakeTimers();
		let up = false;
		const at: number[] = [];
		const retry = createReattach(
			async () => {
				at.push(Date.now());
				if (!up) throw new Error('out of range');
			},
			() => false,
		);
		const start = Date.now();
		retry.schedule();
		await vi.advanceTimersByTimeAsync(8_000);
		expect(at.map((t) => t - start)).toEqual([0, 1000, 3000, 8000]);
		up = true;
		await vi.advanceTimersByTimeAsync(5_000);
		expect(at).toHaveLength(5);
		retry.reset();
		const again = Date.now();
		retry.schedule();
		await vi.advanceTimersByTimeAsync(0);
		expect(at[5] - again).toBe(0);
	});

	it('stands down once settled', async () => {
		vi.useFakeTimers();
		let calls = 0;
		const retry = createReattach(
			async () => {
				calls++;
			},
			() => true,
		);
		retry.schedule();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(calls).toBe(0);
	});
});
