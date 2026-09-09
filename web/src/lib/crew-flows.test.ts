import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	confirm: vi.fn(),
	leaveCrew: vi.fn(),
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

const { leaveBody, leaveCrewFlow } = await import('./crew-flows');

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
