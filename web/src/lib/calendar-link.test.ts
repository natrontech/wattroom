import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	confirm: vi.fn(),
	push: vi.fn(),
	write: vi.fn(),
}));
vi.mock('$lib/confirm.svelte', () => ({ confirm: mocks.confirm }));
vi.mock('$lib/toast.svelte', () => ({ toasts: { push: mocks.push } }));

const { RESET_DONE, confirmCalendarReset, copyCalendarLink, resetBody } =
	await import('./calendar-link');

beforeEach(() => {
	mocks.confirm.mockReset();
	mocks.push.mockReset();
	mocks.write.mockReset();
	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		value: { clipboard: { writeText: mocks.write } },
	});
});

describe('resetBody', () => {
	// errors.md: a confirm says what happens, why, and what to do. The three
	// things a rider cannot find out any other way — that someone else's
	// calendar breaks, that nobody tells them, and that the old link is gone.
	it('names the breakage, who is not told, and the way back', () => {
		for (const scope of ['yours', 'room'] as const) {
			const body = resetBody(scope);
			expect(body).toMatch(/stops updating/);
			expect(body).toMatch(/not told/);
			expect(body).toMatch(/subscribe again/);
			expect(body).toMatch(/cannot be brought back/);
		}
	});

	it('says whose calendar it is', () => {
		expect(resetBody('yours')).toMatch(/your old link/);
		expect(resetBody('room')).toMatch(/this room's old link/);
	});
});

describe('confirmCalendarReset', () => {
	it('asks with the house pair, and passes the refusal on (#1493)', async () => {
		mocks.confirm.mockResolvedValue(false);
		expect(await confirmCalendarReset('room')).toBe(false);
		const ask = mocks.confirm.mock.calls[0][0];
		expect(ask.title).toBe("Reset this room's calendar link?");
		expect(ask.action).toBe('Reset the link');
		// confirm.svelte.ts: the safe answer has one spelling.
		expect(ask.cancel).toBe('Keep it');
		expect(ask.body).toBe(resetBody('room'));
	});

	it('passes a yes on', async () => {
		mocks.confirm.mockResolvedValue(true);
		expect(await confirmCalendarReset('yours')).toBe(true);
		expect(mocks.confirm.mock.calls[0][0].title).toBe(
			'Reset your calendar link?',
		);
	});
});

describe('copyCalendarLink', () => {
	it('copies, and says how to subscribe', async () => {
		mocks.write.mockResolvedValue(undefined);
		await copyCalendarLink('https://w/a.ics');
		expect(mocks.write).toHaveBeenCalledWith('https://w/a.ics');
		expect(mocks.push).toHaveBeenCalledWith(
			'Calendar link copied — subscribe "from URL" in your calendar app.',
		);
	});

	it('hands over the link itself when the clipboard is denied (#1764)', async () => {
		mocks.write.mockRejectedValue(new Error('denied'));
		await copyCalendarLink('https://w/a.ics');
		expect(mocks.push).toHaveBeenCalledWith(
			'Could not copy — the link is https://w/a.ics',
			{ tone: 'error', seconds: 12 },
		);
	});
});

describe('RESET_DONE', () => {
	it('promises no undo', () => {
		expect(RESET_DONE).toMatch(/stop updating/);
	});
});
