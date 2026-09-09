// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const announced: { tag: string; reading: boolean }[] = [];
vi.mock('$lib/messages/announce', () => ({
	announce: (a: { tag: string; reading: boolean }) => announced.push(a),
}));
vi.mock('$lib/notify.svelte', () => ({
	// The real rule (ADR-0042): hidden, or not the front window.
	away: () => document.hidden || !document.hasFocus(),
}));
let open: { id: string; name: string } | null = null;
vi.mock('$lib/dm/dm.svelte', () => ({
	dm: {
		get open() {
			return open;
		},
		seenAt: () => 0,
	},
}));
vi.mock('$lib/people.svelte', () => ({ people: { learn: () => {} } }));
let conversations: unknown[] = [];
const outage = vi.hoisted(() => ({ on: false }));
vi.mock('$lib/api', () => ({
	api: async () =>
		outage.on
			? {
					ok: false,
					error: {
						error: 'internal_error',
						message: 'Messages could not be loaded.',
					},
				}
			: { ok: true, data: { conversations } },
}));

const { dmHeads } = await import('./heads.svelte');

const line = (at: number) => ({
	peerId: 'mara',
	peerName: 'Mara',
	text: 'hi',
	mine: false,
	at,
});

describe('dm heads', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		announced.length = 0;
	});
	afterEach(() => {
		// The poller is module state: one test's interval used to outlive it.
		dmHeads.stop();
		vi.useRealTimers();
		document.hasFocus = () => true;
	});

	// The open thread counts as reading only while the window is in front
	// (ADR-0042, #1440): behind another app a DM must announce like any other.
	it('treats an open thread as read only while the window is in front', async () => {
		conversations = [line(1)];
		dmHeads.start(); // the first answer is the state of the world, not an arrival
		await vi.advanceTimersByTimeAsync(0);
		expect(announced).toEqual([]);

		open = { id: 'mara', name: 'Mara' };
		document.hasFocus = () => false;
		conversations = [line(2)];
		await vi.advanceTimersByTimeAsync(10_000);
		expect(announced.map((a) => a.reading)).toEqual([false]);

		document.hasFocus = () => true;
		conversations = [line(3)];
		await vi.advanceTimersByTimeAsync(10_000);
		expect(announced.map((a) => a.reading)).toEqual([false, true]);
	});

	// A refused poll is a state the list can show (#1816), not a silent
	// "no conversations"; the retry is a poll.
	it('says when the poll was refused, and clears it on the next good answer', async () => {
		outage.on = true;
		conversations = [line(1)];
		dmHeads.start();
		await vi.advanceTimersByTimeAsync(0);
		expect(dmHeads.loaded).toBe(true);
		expect(dmHeads.error).toBe('Messages could not be loaded.');
		expect(dmHeads.heads).toEqual([]);
		outage.on = false;
		dmHeads.retry();
		await vi.advanceTimersByTimeAsync(0);
		expect(dmHeads.error).toBeNull();
		expect(dmHeads.heads).toHaveLength(1);
	});

	// Sign-out stops the poll (#1515): it used to run for the life of the tab
	// with a stale session, and a badge from the last account stayed lit.
	it('stops polling and forgets the heads on stop', async () => {
		conversations = [line(1)];
		dmHeads.start();
		await vi.advanceTimersByTimeAsync(0);
		expect(dmHeads.heads).toHaveLength(1);

		dmHeads.stop();
		expect(dmHeads.heads).toEqual([]);
		conversations = [line(2)];
		await vi.advanceTimersByTimeAsync(30_000);
		expect(dmHeads.heads).toEqual([]);
		expect(announced).toEqual([]);

		// And starts again for the next rider, first answer silent as ever.
		dmHeads.start();
		await vi.advanceTimersByTimeAsync(0);
		expect(dmHeads.heads).toHaveLength(1);
		expect(announced).toEqual([]);
	});
});
