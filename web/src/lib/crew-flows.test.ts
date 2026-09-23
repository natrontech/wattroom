import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	confirm: vi.fn(),
	leaveCrew: vi.fn(),
	transferCrew: vi.fn(),
	goto: vi.fn(),
	push: vi.fn(),
	leave: vi.fn(),
	current: null as { address: { crew: string } } | null,
}));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$lib/confirm.svelte', () => ({ confirm: mocks.confirm }));
vi.mock('$lib/crew', () => ({
	leaveCrew: mocks.leaveCrew,
	transferCrew: mocks.transferCrew,
	joinCrew: vi.fn(),
	inviteLink: (code: string) => `/c/${code}`,
}));
vi.mock('$lib/presence.svelte', () => ({ presence: { reload() {} } }));
vi.mock('$lib/channel/connection.svelte', () => ({
	channelConnection: {
		get current() {
			return mocks.current;
		},
		leave: mocks.leave,
	},
}));
vi.mock('$lib/toast.svelte', () => ({ toasts: { push: mocks.push } }));

const { HAND_OVER_BODY, handOverCrewFlow, leaveBody, leaveCrewFlow } =
	await import('./crew-flows');

describe('leaveCrewFlow', () => {
	beforeEach(() => {
		mocks.confirm.mockReset();
		mocks.leaveCrew.mockReset();
		mocks.push.mockReset();
		mocks.leave.mockReset();
		mocks.current = null;
	});

	it('asks first, and a declined confirm leaves nothing (audit 2026-09-09)', async () => {
		mocks.confirm.mockResolvedValue(false);
		expect(await leaveCrewFlow({ id: 'c1', name: 'Natron' })).toBe(false);
		expect(mocks.leaveCrew).not.toHaveBeenCalled();
		expect(mocks.confirm.mock.calls[0][0]).toEqual({
			title: 'Leave Natron?',
			body: leaveBody('Natron'),
			action: 'Leave the crew',
			cancel: 'Keep it',
		});
		expect(leaveBody('Natron')).toBe(
			'You leave Natron. Its code gets you back in.',
		);
	});

	it('leaves on yes, with a toast that promises no undo', async () => {
		mocks.confirm.mockResolvedValue(true);
		mocks.leaveCrew.mockResolvedValue({ ok: true, data: undefined });
		expect(await leaveCrewFlow({ id: 'c1', name: 'Natron' })).toBe(true);
		expect(mocks.leaveCrew).toHaveBeenCalledWith('c1');
		expect(mocks.push).toHaveBeenCalledWith('You left Natron.');
	});

	// The server severs the socket too, but this side must not keep riding a
	// voice channel of a crew it just left — nor drop one of another crew.
	it('drops the live connection only when it is in the crew left', async () => {
		mocks.confirm.mockResolvedValue(true);
		mocks.leaveCrew.mockResolvedValue({ ok: true, data: undefined });
		mocks.current = { address: { crew: 'c2' } };
		await leaveCrewFlow({ id: 'c1', name: 'Natron' });
		expect(mocks.leave).not.toHaveBeenCalled();
		mocks.current = { address: { crew: 'c1' } };
		await leaveCrewFlow({ id: 'c1', name: 'Natron' });
		expect(mocks.leave).toHaveBeenCalledOnce();
	});
});

describe('handOverCrewFlow (#2095)', () => {
	const crew = { id: 'c1', name: 'Natron' };
	const to = { id: 'u2', displayName: 'Mira' };

	beforeEach(() => {
		mocks.confirm.mockReset();
		mocks.transferCrew.mockReset();
		mocks.push.mockReset();
	});

	it('asks first, and a declined confirm hands nothing over', async () => {
		mocks.confirm.mockResolvedValue(false);
		expect(await handOverCrewFlow(crew, to)).toBe(false);
		expect(mocks.transferCrew).not.toHaveBeenCalled();
		expect(mocks.push).not.toHaveBeenCalled();
	});

	it('asks in the house voice, with the safe answer spelled Keep it', async () => {
		mocks.confirm.mockResolvedValue(false);
		await handOverCrewFlow(crew, to);
		expect(mocks.confirm.mock.calls[0][0]).toEqual({
			title: 'Hand Natron to Mira?',
			body: HAND_OVER_BODY,
			action: 'Hand it over',
			cancel: 'Keep it',
		});
	});

	it('says what happens and what it costs the rider (errors.md)', () => {
		expect(HAND_OVER_BODY).toMatch(/become its owner/);
		expect(HAND_OVER_BODY).toMatch(/you drop to admin/);
		expect(HAND_OVER_BODY).toMatch(/cannot take this back/);
	});

	it('hands over on yes, and says who owns it now', async () => {
		mocks.confirm.mockResolvedValue(true);
		mocks.transferCrew.mockResolvedValue({ ok: true, data: undefined });
		expect(await handOverCrewFlow(crew, to)).toBe(true);
		expect(mocks.transferCrew).toHaveBeenCalledWith('c1', 'u2');
		expect(mocks.push).toHaveBeenCalledWith(
			'Mira owns Natron now. You are an admin.',
		);
	});

	it('keeps the crew, and says why, when the server refuses', async () => {
		mocks.confirm.mockResolvedValue(true);
		mocks.transferCrew.mockResolvedValue({
			ok: false,
			error: { error: 'conflict', message: 'Mira left the crew.' },
		});
		expect(await handOverCrewFlow(crew, to)).toBe(false);
		expect(mocks.push).toHaveBeenCalledWith('Mira left the crew.', {
			tone: 'error',
		});
	});
});
