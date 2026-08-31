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

/**
 * The actual promise of the feature (#286): two riders, two badly-set
 * clocks, one playhead. Each client gets its OWN module instance — the
 * offset estimate is module state, and two riders are two processes.
 */
async function isolatedClient(skewMs: number, delaysMs: number[]) {
	vi.resetModules();
	const clock = await import('./server-clock');
	const at = (serverMs: number) => {
		// Its wall clock reads server time plus its own skew; a tick sent at
		// serverMs arrives that many ms of network later.
		vi.setSystemTime(serverMs + skewMs);
		return clock;
	};
	return {
		/** Feed the same broadcast this client saw, with its own delays. */
		receive(sentAtMs: number, i: number) {
			const delay = delaysMs[i % delaysMs.length];
			at(sentAtMs + delay).observeServerTime(sentAtMs);
		},
		/** What this client thinks the server clock reads, at server time `now`. */
		serverNowAt(nowMs: number) {
			return at(nowMs).serverNow();
		},
		/** What it USED to do: its own wall clock, straight into the playhead. */
		localNowAt(nowMs: number) {
			vi.setSystemTime(nowMs + skewMs);
			return Date.now();
		},
	};
}

describe('two clients, one playhead', () => {
	it('agrees across riders whose wall clocks are seconds apart', async () => {
		vi.useFakeTimers();
		// A laptop back from sleep, 4.2 s fast. A phone 1.8 s slow. Both
		// plausible; together they are 6 s of disagreement.
		const fast = await isolatedClient(4_200, [40, 120, 15, 300]);
		const slow = await isolatedClient(-1_800, [90, 25, 210, 60]);

		const START = 1_700_000_000_000;
		for (let i = 0; i < 8; i++) {
			const sent = START + i * 1_000; // the same 1 Hz broadcast
			fast.receive(sent, i);
			slow.receive(sent, i);
		}

		// The room is 30 s into a track, anchored a minute ago.
		const deck = { positionSec: 30, anchorMs: START, playing: true };
		const now = START + 60_000;

		const { playheadAt } = await import('./playhead');
		const onFast = playheadAt(deck, fast.serverNowAt(now));
		const onSlow = playheadAt(deck, slow.serverNowAt(now));

		// Both land on the truth, within their least network delay.
		expect(onFast).toBeCloseTo(90, 1);
		expect(onSlow).toBeCloseTo(90, 1);
		// And on each other — the whole point. A shared beat, not two rides.
		expect(Math.abs(onFast - onSlow)).toBeLessThan(0.1);

		// The bug this replaced: the same two riders, using their own clocks,
		// were six seconds apart on a track they were "listening to together".
		const wasFast = playheadAt(deck, fast.localNowAt(now));
		const wasSlow = playheadAt(deck, slow.localNowAt(now));
		expect(Math.abs(wasFast - wasSlow)).toBeCloseTo(6, 1);
	});

	it('holds agreement after one rider reconnects to a restarted server', async () => {
		vi.useFakeTimers();
		const steady = await isolatedClient(4_200, [40]);
		const dropped = await isolatedClient(-1_800, [90]);
		const START = 1_700_000_000_000;
		for (let i = 0; i < 8; i++) {
			steady.receive(START + i * 1_000, i);
			dropped.receive(START + i * 1_000, i);
		}

		// One socket drops and comes back: its window is cleared, and it has
		// to re-earn the offset from scratch off the same broadcast.
		vi.resetModules();
		const reconnected = await isolatedClient(-1_800, [90]);
		for (let i = 0; i < 8; i++)
			reconnected.receive(START + 20_000 + i * 1_000, i);

		const deck = { positionSec: 0, anchorMs: START, playing: true };
		const now = START + 40_000;
		const { playheadAt } = await import('./playhead');
		expect(
			Math.abs(
				playheadAt(deck, steady.serverNowAt(now)) -
					playheadAt(deck, reconnected.serverNowAt(now)),
			),
		).toBeLessThan(0.1);
	});
});

describe('a backgrounded tab', () => {
	const setVisibility = (state: 'visible' | 'hidden') =>
		vi.stubGlobal('document', { visibilityState: state });

	afterEach(() => vi.unstubAllGlobals());

	it('keeps the offset it learned on screen instead of the throttled one', async () => {
		vi.useFakeTimers();
		vi.resetModules();
		const clock = await import('./server-clock');
		setVisibility('visible');
		// On screen: ticks arrive promptly, so the estimate is good.
		for (let i = 0; i < 8; i++) {
			vi.setSystemTime(i * 1_000 + 30); // 30 ms of network
			clock.observeServerTime(i * 1_000 + 3_000);
		}
		expect(clock.clockOffsetMs()).toBe(2_970);

		// Backgrounded: the renderer batches delivery, every tick reads ~2 s
		// late. Eight of those would have evicted every good sample.
		setVisibility('hidden');
		for (let i = 8; i < 20; i++) {
			vi.setSystemTime(i * 1_000 + 2_000);
			clock.observeServerTime(i * 1_000 + 3_000);
		}
		expect(clock.clockOffsetMs()).toBe(2_970);
	});

	it('still takes a first reading when it has none at all', async () => {
		vi.useFakeTimers();
		vi.resetModules();
		const clock = await import('./server-clock');
		setVisibility('hidden');
		// Opened in the background: a rough offset beats the raw local clock.
		vi.setSystemTime(1_000);
		clock.observeServerTime(6_000);
		expect(clock.clockOffsetMs()).toBe(5_000);
	});
});
