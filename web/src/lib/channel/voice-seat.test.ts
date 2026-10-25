import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage } from '$lib/protocol';
import { createVoiceSeat, VOICE_ANSWER_MS } from './voice-seat';

describe('the voice seat (ADR-0089)', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	const rig = () => {
		const sent: ClientMessage[] = [];
		const seat = createVoiceSeat(
			(m) => sent.push(m),
			() => 'tab-1',
			() => 'phone',
		);
		return { sent, seat };
	};

	it('stays out of the call when another screen carries the voice', async () => {
		const { sent, seat } = rig();
		const here = seat.claim(false, {});
		seat.heard({
			error: {
				code: 'voice_conflict',
				message: 'Your voice is on your desktop.',
			},
		});
		await expect(here).resolves.toBe(false);
		expect(sent).toEqual([
			{ voice: { on: true, take: false, tab: 'tab-1', device: 'phone' } },
		]);
	});

	it('joins on a pairing that says the voice is here', async () => {
		const { seat } = rig();
		const here = seat.claim(false, {});
		seat.heard({ pairing: { held: ['trainer'] } });
		seat.heard({ pairing: { held: ['voice'] } });
		await expect(here).resolves.toBe(true);
	});

	it('takes the voice past a pairing that still names the other screen', async () => {
		const { sent, seat } = rig();
		const here = seat.claim(true, { elsewhere: { voice: 'desktop' } });
		seat.heard({ pairing: { elsewhere: { voice: 'desktop' } } });
		seat.heard({ pairing: { held: ['voice'] } });
		await expect(here).resolves.toBe(true);
		expect(sent[0]).toMatchObject({ voice: { on: true, take: true } });
	});

	it('joins as before when an older server never answers', async () => {
		const { seat } = rig();
		const here = seat.claim(false, {});
		vi.advanceTimersByTime(VOICE_ANSWER_MS);
		await expect(here).resolves.toBe(true);
	});

	it('lets go once on leaving, and replays a held claim on a fresh socket', () => {
		const { sent, seat } = rig();
		seat.release();
		expect(sent).toEqual([]);
		void seat.claim(false, { held: ['voice'] });
		seat.replay();
		seat.release();
		seat.replay();
		expect(sent.map((m) => m.voice?.on)).toEqual([true, true, false]);
	});
});
