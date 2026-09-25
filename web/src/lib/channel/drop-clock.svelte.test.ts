// @vitest-environment happy-dom
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dropClock } from '$lib/channel/drop-clock.svelte';
import type { LiveStatus } from '$lib/channel/live.svelte';

/**
 * The connection banner's one number (#2855): how long the socket has been
 * down. It was read from Date.now() in the template, and nothing re-rendered
 * it while offline, so a rider saw "0:00 stored" for the whole outage — and a
 * game's "30 s of disconnect grace left" until they were eliminated.
 *
 * `seconds` is read the way the template reads it: once per change the
 * reactive graph announces. A value that is only right when polled, and never
 * invalidates anything, is the bug — so each assertion counts the reads.
 */
describe('dropClock', () => {
	// Svelte schedules its flush on a microtask; only the clock is faked.
	beforeEach(() =>
		vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }),
	);
	afterEach(() => vi.useRealTimers());

	async function withClock(
		body: (
			live: { status: LiveStatus },
			shown: () => number | undefined,
		) => Promise<void>,
	) {
		const live = $state<{ status: LiveStatus }>({ status: 'live' });
		// What the banner last rendered: an effect re-runs only when the
		// clock's value is invalidated, exactly like the template.
		let shown: number | undefined;
		const stop = $effect.root(() => {
			const drop = dropClock(() => live.status);
			$effect(() => {
				shown = drop.seconds;
			});
		});
		try {
			await tick();
			await body(live, () => shown);
		} finally {
			stop();
		}
	}

	async function seconds(ms: number) {
		vi.advanceTimersByTime(ms);
		await tick();
	}

	it('counts every second the socket stays down', () =>
		withClock(async (live, shown) => {
			expect(shown()).toBe(0);
			live.status = 'reconnecting';
			await tick();
			expect(shown()).toBe(0);
			await seconds(3000);
			expect(shown()).toBe(3);
			// Going offline mid-outage is the same outage, not a new one.
			live.status = 'offline';
			await tick();
			await seconds(12_000);
			expect(shown()).toBe(15);
		}));

	it('keeps counting through a redial and starts over once live', () =>
		withClock(async (live, shown) => {
			live.status = 'reconnecting';
			await tick();
			await seconds(5000);
			live.status = 'connecting';
			await tick();
			await seconds(2000);
			live.status = 'reconnecting';
			await tick();
			expect(shown()).toBe(7);
			live.status = 'live';
			await tick();
			expect(shown()).toBe(0);
			live.status = 'reconnecting';
			await tick();
			await seconds(2000);
			expect(shown()).toBe(2);
		}));
});
