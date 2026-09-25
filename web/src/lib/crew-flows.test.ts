import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	confirm: vi.fn(),
	leaveCrew: vi.fn(),
	transferCrew: vi.fn(),
	goto: vi.fn(),
	push: vi.fn(),
	leave: vi.fn(),
	current: null as { address: { crew: string } } | null,
	crews: [] as {
		id: string;
		name: string;
		goesWithChannel?: boolean;
		lastOut?: boolean;
	}[],
	reload: vi.fn(),
	deleteChannel: vi.fn(),
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
		get crews() {
			return mocks.crews;
		},
		reload: mocks.reload,
	},
}));
vi.mock('$lib/channels', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/channels')>()),
	deleteChannel: mocks.deleteChannel,
}));
vi.mock('$lib/channel/connection.svelte', () => ({
	channelConnection: {
		get current() {
			return mocks.current;
		},
		leave: mocks.leave,
	},
}));
vi.mock('$lib/toast.svelte', () => ({ toasts: { push: mocks.push } }));

const {
	HAND_OVER_BODY,
	deleteChannelFlow,
	handOverCrewFlow,
	leaveBody,
	leaveCrewFlow,
} = await import('./crew-flows');

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

// The last one out of a crew with nothing left in it takes it (#2079), and
// the confirm says so on the server's word rather than promising the code.
describe('leaveCrewFlow, last one out', () => {
	beforeEach(() => {
		mocks.confirm.mockReset();
		mocks.leaveCrew.mockReset();
		mocks.push.mockReset();
		mocks.crews = [];
	});

	it('says the crew goes when the crew list says lastOut', async () => {
		mocks.crews = [{ id: 'c1', name: 'Natron', lastOut: true }];
		mocks.confirm.mockResolvedValue(true);
		mocks.leaveCrew.mockResolvedValue({ ok: true, data: undefined });
		await leaveCrewFlow({ id: 'c1', name: 'Natron' });
		const body = mocks.confirm.mock.calls[0][0].body as string;
		expect(body).toContain('it goes when you leave');
		expect(body).not.toContain('gets you back in');
		expect(mocks.push).toHaveBeenCalledWith('You left Natron, and it is gone.');
	});
});

// A crew's last channel, with nobody else in the crew, takes the crew
// (#1935, #2837): the confirm names it and the rider lands Home, because the
// crew page they were on no longer exists.
describe('deleteChannelFlow', () => {
	const channel = { id: 'ch1', name: 'Pain Cave', kind: 'voice' as const };
	beforeEach(() => {
		mocks.confirm.mockReset();
		mocks.deleteChannel.mockReset();
		mocks.goto.mockReset();
		mocks.push.mockReset();
		mocks.reload.mockReset();
		mocks.crews = [];
	});

	it('names the crew going, and takes the rider Home after', async () => {
		mocks.crews = [{ id: 'c1', name: 'Natron', goesWithChannel: true }];
		mocks.confirm.mockResolvedValue(true);
		mocks.deleteChannel.mockResolvedValue({ ok: true, data: undefined });
		expect(await deleteChannelFlow(channel, 'c1')).toBe(false);
		expect(mocks.confirm.mock.calls[0][0].body).toContain('so Natron goes too');
		expect(mocks.goto).toHaveBeenCalledWith('/home');
		expect(mocks.reload).toHaveBeenCalled();
	});

	it('leaves a crew that stands to the caller', async () => {
		mocks.crews = [{ id: 'c1', name: 'Natron' }];
		mocks.confirm.mockResolvedValue(true);
		mocks.deleteChannel.mockResolvedValue({ ok: true, data: undefined });
		expect(await deleteChannelFlow(channel, 'c1')).toBe(true);
		expect(mocks.confirm.mock.calls[0][0].body).not.toContain('goes too');
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('deletes nothing on no, and says a refusal', async () => {
		mocks.confirm.mockResolvedValue(false);
		expect(await deleteChannelFlow(channel, 'c1')).toBe(false);
		expect(mocks.deleteChannel).not.toHaveBeenCalled();
		mocks.confirm.mockResolvedValue(true);
		mocks.deleteChannel.mockResolvedValue({
			ok: false,
			error: { error: 'forbidden', message: 'Only admins delete channels.' },
		});
		expect(await deleteChannelFlow(channel, 'c1')).toBe(false);
		expect(mocks.push).toHaveBeenCalledWith('Only admins delete channels.', {
			tone: 'error',
		});
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
