import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '$lib/api';
import { toasts } from '$lib/toast.svelte';
import { openMember } from './open-member';

vi.mock('$lib/api', () => ({ api: vi.fn() }));

const mockApi = vi.mocked(api);

describe('openMember (#540)', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		mockApi.mockReset();
	});

	it('resolves the rail name against the room and opens their page', async () => {
		mockApi.mockResolvedValue({
			ok: true,
			data: {
				members: [
					{ id: 'u1', displayName: 'Mara' },
					{ id: 'u2', displayName: 'Ines' },
				],
			},
		});
		const go = vi.fn();
		await openMember('dawn-patrol', 'Ines', go);
		expect(mockApi).toHaveBeenCalledWith('/api/rooms/dawn-patrol');
		expect(go).toHaveBeenCalledWith('/u/u2');
	});

	it('says who it could not find rather than going nowhere quietly', async () => {
		mockApi.mockResolvedValue({
			ok: true,
			data: { members: [{ id: 'u1', displayName: 'Mara' }] },
		});
		const push = vi.spyOn(toasts, 'push').mockImplementation(() => {});
		const go = vi.fn();
		await openMember('dawn-patrol', 'Ines', go);
		expect(go).not.toHaveBeenCalled();
		expect(push).toHaveBeenCalledWith('Ines is not a member of this room.', {
			tone: 'error',
		});
	});

	it("passes the server's own sentence on when the lookup fails", async () => {
		mockApi.mockResolvedValue({
			ok: false,
			error: { error: 'forbidden', message: 'You are not in this room.' },
		});
		const push = vi.spyOn(toasts, 'push').mockImplementation(() => {});
		const go = vi.fn();
		await openMember('dawn-patrol', 'Ines', go);
		expect(go).not.toHaveBeenCalled();
		expect(push).toHaveBeenCalledWith('You are not in this room.', {
			tone: 'error',
		});
	});
});
