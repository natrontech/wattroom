// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	dismissRequest,
	removeFriend,
	withdrawRequest,
} from '$lib/friends/actions';

const calls = vi.hoisted(() => ({
	sent: [] as { path: string; method?: string }[],
	fail: null as string | null,
}));
vi.mock('$lib/api', () => ({
	api: async (path: string, init?: { method?: string }) => {
		calls.sent.push({ path, method: init?.method });
		return calls.fail
			? { ok: false as const, error: { message: calls.fail } }
			: { ok: true as const, data: {} };
	},
}));
vi.mock('$lib/friends/friends.svelte', () => ({
	friends: { reload: async () => {} },
}));
const shown = vi.hoisted(() => ({
	toasts: [] as { text: string; undo?: () => void }[],
}));
vi.mock('$lib/toast.svelte', () => ({
	toasts: {
		push: (text: string, opts?: { undo?: () => void }) =>
			shown.toasts.push({ text, undo: opts?.undo }),
	},
}));

const ben = { id: 'u1', name: 'Ben' };

beforeEach(() => {
	calls.sent = [];
	calls.fail = null;
	shown.toasts = [];
});

describe('the friendship acts (#2172)', () => {
	it('says what happened, and offers the way back', async () => {
		expect(await dismissRequest(ben)).toBeNull();
		expect(shown.toasts[0].text).toBe("Dismissed Ben's request.");
		// A dismissal is the one that can be taken back as it was.
		shown.toasts[0].undo?.();
		await vi.waitFor(() =>
			expect(calls.sent.at(-1)).toEqual({
				path: '/api/friends/u1/restore',
				method: 'POST',
			}),
		);
	});

	it('asks again where it cannot restore — acceptance needs them twice', async () => {
		await withdrawRequest(ben);
		expect(shown.toasts[0].text).toBe('Withdrew your request to Ben.');
		shown.toasts[0].undo?.();
		await vi.waitFor(() =>
			expect(calls.sent.at(-1)?.path).toBe('/api/friends'),
		);
		expect(shown.toasts.at(-1)?.text).toBe('Sent Ben a new friend request.');
	});

	it('hands a refusal back instead of claiming it happened', async () => {
		calls.fail = 'That rider is gone.';
		expect(await removeFriend(ben)).toBe('That rider is gone.');
		expect(shown.toasts).toEqual([]);
	});
});
