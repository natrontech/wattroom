import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createTalkHold,
	createTalkOpener,
	TALK_BEAT_MS,
	type TalkMic,
} from '$lib/ride/remote-talk';
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
			{
				press: () => undefined,
				release: () => undefined,
				shifts: () => true,
				trim: () => undefined,
			},
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

describe('Talk on the holding tab (#4163)', () => {
	const micOf = (over: Partial<TalkMic> = {}) => {
		const mic = {
			status: 'live',
			micOn: false,
			handedOff: false,
			away: false,
			held: [] as boolean[],
			setPtt(held: boolean) {
				mic.held.push(held);
			},
			toggleMic: vi.fn(async () => {
				mic.micOn = !mic.micOn;
			}),
			...over,
		};
		return mic;
	};
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

	it('opens a closed mic for the hold and closes it after', async () => {
		const mic = micOf();
		const talk = createTalkOpener(mic);
		talk(true);
		await settle();
		expect(mic.micOn).toBe(true);
		talk(false);
		await settle();
		expect(mic.micOn).toBe(false);
		expect(mic.held).toEqual([true, false]);
	});

	it('leaves an open mic open, and a release lands after its open', async () => {
		const open = micOf({ micOn: true });
		const talk = createTalkOpener(open);
		talk(true);
		talk(false);
		await settle();
		expect(open.toggleMic).not.toHaveBeenCalled();

		const closed = micOf();
		const quick = createTalkOpener(closed);
		quick(true);
		quick(false);
		await settle();
		expect(closed.toggleMic).toHaveBeenCalledTimes(2);
		expect(closed.micOn).toBe(false);
	});

	it.each([
		['the mic lives on another screen', { handedOff: true }],
		['the rider is away', { away: true }],
		['voice is not connected', { status: 'off' }],
	])('opens nothing when %s', async (_, over) => {
		const mic = micOf(over);
		createTalkOpener(mic)(true);
		await settle();
		expect(mic.toggleMic).not.toHaveBeenCalled();
	});
});
