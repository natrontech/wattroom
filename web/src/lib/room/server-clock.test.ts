import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	clockOffsetMs,
	observeServerTime,
	resetServerClock,
	serverNow,
} from './server-clock';

afterEach(() => {
	resetServerClock();
	vi.useRealTimers();
});

/** Pretend this machine's clock reads `local` while the server sends `at`. */
function tickAt(local: number, at: number) {
	vi.setSystemTime(local);
	observeServerTime(at);
}

describe('server clock', () => {
	it('recovers a skewed clock from the least-delayed tick', () => {
		vi.useFakeTimers();
		// This rider's clock runs 4 s behind the server, and each tick takes a
		// different amount of time to arrive.
		const skew = -4_000;
		for (const delay of [120, 40, 300, 15, 90]) {
			const serverSent = 1_000_000 + delay;
			tickAt(serverSent + skew + delay, serverSent);
		}
		// The 15 ms tick is the truest sample: within its delay of the skew.
		expect(clockOffsetMs()).toBeCloseTo(-skew, -2);
		expect(serverNow() - Date.now()).toBe(clockOffsetMs());
	});

	it('re-converges after the offset jumps, and resets with the socket', () => {
		vi.useFakeTimers();
		for (let i = 0; i < 8; i++) tickAt(i * 1_000, i * 1_000 + 9_000);
		expect(clockOffsetMs()).toBe(9_000);
		// The clock is corrected mid-session: eight ticks flush the window.
		for (let i = 8; i < 16; i++) tickAt(i * 1_000, i * 1_000);
		expect(clockOffsetMs()).toBe(0);

		observeServerTime(Date.now() + 5_000);
		expect(clockOffsetMs()).toBe(5_000);
		resetServerClock();
		expect(clockOffsetMs()).toBe(0);
	});

	it('ignores junk timestamps rather than poisoning the estimate', () => {
		vi.useFakeTimers();
		tickAt(1_000, 3_000);
		observeServerTime(0);
		observeServerTime(NaN);
		expect(clockOffsetMs()).toBe(2_000);
	});
});
