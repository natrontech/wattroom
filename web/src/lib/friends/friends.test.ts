import { describe, expect, it } from 'vitest';
import { declineEvent, friendEvent, type Friend } from './friends.svelte';

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
