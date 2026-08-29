import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTicker } from './ticker';

afterEach(() => vi.useRealTimers());

/**
 * vitest runs in node, where `Worker` does not exist, so these exercise the
 * setInterval fallback — which is the path that matters: the wall-clock delta is
 * what has to be right precisely when the timer is being throttled.
 */
describe('createTicker', () => {
	it('reports one second for an on-time fire', () => {
		vi.useFakeTimers();
		let clock = 1_000_000;
		const seen: number[] = [];
		const ticker = createTicker((s) => seen.push(s), { now: () => clock });

		clock += 1000;
		vi.advanceTimersByTime(1000);

		expect(seen).toEqual([1]);
		ticker.stop();
	});

	it('reports the seconds actually covered when a fire arrives late', () => {
		vi.useFakeTimers();
		let clock = 1_000_000;
		const seen: number[] = [];
		const ticker = createTicker((s) => seen.push(s), { now: () => clock });

		// What an intensively throttled tab does: one fire covering a whole minute.
		clock += 60_000;
		vi.advanceTimersByTime(60_000);

		// 60, not 1 — the ride advances by the time that really passed.
		expect(seen[0]).toBe(60);
		ticker.stop();
	});

	it('never reports less than a second, so the ride cannot rewind', () => {
		vi.useFakeTimers();
		let clock = 1_000_000;
		const seen: number[] = [];
		const ticker = createTicker((s) => seen.push(s), { now: () => clock });

		// A clock that steps backwards — NTP correction, or waking from sleep.
		clock -= 5000;
		vi.advanceTimersByTime(1000);

		expect(seen).toEqual([1]);
		ticker.stop();
	});

	it('falls back to a main-thread timer where Worker does not exist', () => {
		vi.useFakeTimers();
		const ticker = createTicker(() => {});
		expect(ticker.kind).toBe('timeout');
		ticker.stop();
	});

	it('stops firing once stopped', () => {
		vi.useFakeTimers();
		let clock = 1_000_000;
		const seen: number[] = [];
		const ticker = createTicker((s) => seen.push(s), { now: () => clock });

		ticker.stop();
		clock += 5000;
		vi.advanceTimersByTime(5000);

		expect(seen).toEqual([]);
	});
});
