// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
// A new request rings a cue, and this environment has no AudioContext —
// nothing here is about the sound.
vi.mock('$lib/messages/announce', () => ({ announce: () => {} }));

import {
	declineEvent,
	friendEvent,
	friendPlace,
	friends,
	type Friend,
} from './friends.svelte';

const friend = (over: Partial<Friend> = {}): Friend => ({
	id: 'ruben',
	name: 'Ruben',
	status: 'pending_in',
	at: 1000,
	...over,
});

describe('friendEvent', () => {
	it('announces a request nobody had seen before', () => {
		expect(friendEvent(friend(), undefined)).toEqual({
			tag: 'friend-req-ruben',
			title: 'Ruben wants to be friends',
		});
	});

	it('stays quiet about a request that was already pending', () => {
		expect(friendEvent(friend(), 'pending_in')).toBeNull();
	});

	it('announces MY request being accepted, not a friendship I already had', () => {
		const accepted = friend({ status: 'accepted' });
		expect(friendEvent(accepted, 'pending_out')).toEqual({
			tag: 'friend-ok-ruben',
			title: 'Ruben accepted your friend request',
		});
		expect(friendEvent(accepted, 'accepted')).toBeNull();
		// Their request, accepted by me — I clicked it, it does not need a blip.
		expect(friendEvent(accepted, 'pending_in')).toBeNull();
	});

	it('leaves a dismissal to declineEvent — no row survives it to diff', () => {
		expect(declineEvent({ id: 'ruben', name: 'Ruben', at: 1000 })).toEqual({
			tag: 'friend-no-ruben',
			title: 'Ruben dismissed your friend request',
		});
	});

	it('stays quiet about my own outgoing request', () => {
		expect(
			friendEvent(friend({ status: 'pending_out' }), undefined),
		).toBeNull();
	});
});

/**
 * How many people are waiting on you (#1010) — the number the sidebar's badge
 * draws. Not unread semantics on purpose: seeing a request is not answering
 * one, so it only goes down when the request stops being open.
 */
describe('friends.waiting', () => {
	afterEach(() => vi.unstubAllGlobals());

	async function seed(...list: Friend[]) {
		vi.stubGlobal('fetch', async () => ({
			ok: true,
			status: 200,
			json: async () => ({ friends: list, code: 'ABC123', declines: [] }),
		}));
		await friends.reload();
	}

	it('counts only the people waiting on YOU', async () => {
		await seed(
			friend({ id: 'a', status: 'pending_in' }),
			friend({ id: 'b', status: 'pending_in' }),
			friend({ id: 'c', status: 'pending_out' }),
			friend({ id: 'd', status: 'accepted' }),
		);
		expect(friends.waiting).toBe(2);
	});

	// Never a zero badge: the sidebar draws nothing at all.
	it('is zero when nobody is waiting', async () => {
		await seed(
			friend({ id: 'c', status: 'pending_out' }),
			friend({ id: 'd', status: 'accepted' }),
		);
		expect(friends.waiting).toBe(0);
	});

	it('goes down when a request is answered, not when the page is opened', async () => {
		await seed(friend({ id: 'a' }), friend({ id: 'b' }));
		expect(friends.waiting).toBe(2);
		// Accepting one is what changes it — the next refresh carries the truth.
		await seed(friend({ id: 'a', status: 'accepted' }), friend({ id: 'b' }));
		expect(friends.waiting).toBe(1);
	});
});

describe('friendPlace', () => {
	// ADR-0012: the room's name only for a member of it, "riding elsewhere"
	// otherwise — and riding is never inferred from being in a room (#2168).
	const accepted = (over: Partial<Friend> = {}) =>
		friend({ status: 'accepted', ...over });

	it('names the room for a member, and says riding when they are', () => {
		expect(
			friendPlace(accepted({ inRoom: true, roomName: 'Velvet Hammer' })),
		).toBe('in Velvet Hammer');
		expect(
			friendPlace(
				accepted({ inRoom: true, roomName: 'Velvet Hammer', riding: true }),
			),
		).toBe('riding in Velvet Hammer');
	});

	it('keeps the boundary for a room the viewer is not in', () => {
		expect(friendPlace(accepted({ inRoom: true }))).toBe('in a room');
		expect(friendPlace(accepted({ inRoom: true, riding: true }))).toBe(
			'riding elsewhere',
		);
	});

	it('says online, and nothing about a request or someone offline', () => {
		expect(friendPlace(accepted({ online: true }))).toBe('online');
		expect(friendPlace(accepted())).toBe('');
		expect(friendPlace(friend({ status: 'pending_in', online: true }))).toBe(
			'',
		);
	});
});
