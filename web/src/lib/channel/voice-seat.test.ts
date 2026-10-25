import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage } from '$lib/protocol';
import {
	createVoiceSeat,
	VOICE_ANSWER_MS,
	VOICE_WAIT_MAX_MS,
} from './voice-seat';

describe('the voice seat (ADR-0089)', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	const rig = ({ tab = 'tab-1', open = true } = {}) => {
		const sent: ClientMessage[] = [];
		const socket = { open };
		const seat = createVoiceSeat(
			(m) => sent.push(m),
			() => tab,
			() => 'phone',
			() => socket.open,
		);
		return { sent, seat, socket };
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

	it('claims nothing more once refused, even when its socket reconnects', async () => {
		const { sent, seat } = rig();
		const here = seat.claim(false, {});
		seat.heard({ error: { code: 'voice_conflict', message: '' } });
		await expect(here).resolves.toBe(false);
		seat.replay();
		seat.release();
		expect(sent).toHaveLength(1);
	});

	it('waits for a socket that is down rather than joining beside the other screen', async () => {
		const { seat, socket } = rig({ open: false });
		let settled: boolean | null = null;
		void seat.claim(true, {}).then((here) => (settled = here));
		await vi.advanceTimersByTimeAsync(VOICE_ANSWER_MS * 2);
		expect(settled).toBeNull();
		socket.open = true;
		seat.heard({ pairing: { held: ['voice'] } });
		await vi.advanceTimersByTimeAsync(0);
		expect(settled).toBe(true);

		const stuck = rig({ open: false }).seat.claim(false, {});
		await vi.advanceTimersByTimeAsync(VOICE_WAIT_MAX_MS);
		await expect(stuck).resolves.toBe(false);
	});

	it('claims nothing without a tab label, and joins as an older client', async () => {
		const { sent, seat } = rig({ tab: '' });
		await expect(seat.claim(false, {})).resolves.toBe(true);
		seat.replay();
		seat.release();
		expect(sent).toEqual([]);
	});
});
