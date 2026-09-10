import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	confirm: vi.fn(),
	leaveCrew: vi.fn(),
	transferCrew: vi.fn(),
	goto: vi.fn(),
	push: vi.fn(),
	rooms: [] as {
		slug: string;
		role?: string;
		access?: string;
		crew?: { id: string };
	}[],
}));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$lib/confirm.svelte', () => ({ confirm: mocks.confirm }));
vi.mock('$lib/crew', () => ({
	leaveCrew: mocks.leaveCrew,
	transferCrew: mocks.transferCrew,
	joinCrew: vi.fn(),
	inviteLink: (code: string) => `/c/${code}`,
}));
vi.mock('$lib/presence.svelte', () => ({
	presence: {
		get rooms() {
			return mocks.rooms;
		},
		reload() {},
	},
}));
vi.mock('$lib/room/connection.svelte', () => ({
	roomConnection: { current: null, leave() {} },
}));
vi.mock('$lib/toast.svelte', () => ({ toasts: { push: mocks.push } }));

const { HAND_OVER_BODY, handOverCrewFlow, leaveBody, leaveCrewFlow } =
	await import('./crew-flows');

describe('leaveBody', () => {
	it('names what goes', () => {
		expect(leaveBody('Natron', 0, 0)).toBe(
			'You leave Natron. Its code gets you back in.',
		);
		expect(leaveBody('Natron', 1, 0)).toMatch(
			/^You leave Natron and the room of it you are in\./,
		);
		expect(leaveBody('Natron', 3, 1)).toMatch(
			/the 3 rooms .* a private room needs a fresh invitation/,
		);
	});
});

describe('leaveCrewFlow', () => {
	beforeEach(() => {
		mocks.confirm.mockReset();
		mocks.leaveCrew.mockReset();
		mocks.push.mockReset();
		mocks.rooms = [
			{ slug: 'a', role: 'member', access: 'private', crew: { id: 'c1' } },
		];
	});

	it('asks first, and a declined confirm leaves nothing (audit 2026-09-09)', async () => {
		mocks.confirm.mockResolvedValue(false);
		expect(await leaveCrewFlow({ id: 'c1', name: 'Natron' })).toBe(false);
		expect(mocks.leaveCrew).not.toHaveBeenCalled();
		expect(mocks.confirm.mock.calls[0][0].body).toMatch(/private room/);
	});

	it('leaves on yes, with a toast that promises no undo', async () => {
		mocks.confirm.mockResolvedValue(true);
		mocks.leaveCrew.mockResolvedValue({ ok: true, data: undefined });
		expect(await leaveCrewFlow({ id: 'c1', name: 'Natron' })).toBe(true);
		expect(mocks.leaveCrew).toHaveBeenCalledWith('c1');
		expect(mocks.push).toHaveBeenCalledWith('You left Natron.');
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
