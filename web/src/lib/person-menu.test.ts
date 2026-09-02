import { describe, expect, it, vi } from 'vitest';
import { personMenu } from '$lib/person-menu';

describe('personMenu (#486)', () => {
	it('leads with what a click on the object already does', () => {
		expect(personMenu('u1', () => {}).map((item) => item.label)).toEqual([
			'View profile',
			'Message',
			'Add friend',
		]);
		expect(
			personMenu('u1', () => {}, { conversation: true }).map(
				(item) => item.label,
			),
		).toEqual(['Open the conversation', 'View profile', 'Add friend']);
	});

	it('goes where the row already links', () => {
		const go = vi.fn();
		for (const item of personMenu('u1', go).slice(0, 2)) item.onSelect();
		expect(go.mock.calls).toEqual([['/u/u1'], ['/messages/dm/u1']]);
	});

	it('offers no conversation and no friendship with yourself', () => {
		const [, message, friend] = personMenu('me', () => {}, { you: true });
		expect([message.disabled, friend.disabled]).toEqual([true, true]);
		const [, theirs, theirFriend] = personMenu('them', () => {});
		expect(theirs.disabled).toBeFalsy();
		expect(theirFriend.disabled).toBeFalsy();
	});

	// The menu never asks who is already a friend — the server's own refusal
	// is the answer, and it is a sentence worth showing (#532).
	it('asks the server to be friends, by id', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const [, , friend] = personMenu('u2', () => {});
		friend.onSelect();
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
		const [path, init] = fetchMock.mock.calls[0];
		expect(path).toBe('/api/friends');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ userId: 'u2' });
		vi.unstubAllGlobals();
	});
});
