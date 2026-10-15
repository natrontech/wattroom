import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTalkHold, TALK_BEAT_MS } from '$lib/ride/remote-talk';
import { createRemoteRunner, TALK_KEEPALIVE_MS } from '$lib/ride/keys';

describe('the phone remote talk hold', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('beats while held and sends one talk-up on release', () => {
		const sent: string[] = [];
		const hold = createTalkHold((a) => sent.push(a));
		hold.down();
		hold.down();
		vi.advanceTimersByTime(TALK_BEAT_MS * 2);
		hold.up();
		hold.up();
		vi.advanceTimersByTime(TALK_BEAT_MS * 3);
		expect(sent).toEqual([
			'talk-down',
			'talk-keepalive',
			'talk-keepalive',
			'talk-up',
		]);
	});

	it('beats inside the holder window, so a live hold is never released', () => {
		expect(TALK_BEAT_MS).toBeLessThan(TALK_KEEPALIVE_MS);
		const mic: boolean[] = [];
		const runner = createRemoteRunner(
			{ press: () => undefined, release: () => undefined },
			(held) => mic.push(held),
		);
		const hold = createTalkHold((action) => runner.run({ action }));
		hold.down();
		vi.advanceTimersByTime(TALK_KEEPALIVE_MS * 3);
		expect(mic).toEqual([true]);
		hold.up();
		expect(mic).toEqual([true, false]);
	});
});
