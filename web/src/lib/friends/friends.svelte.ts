/**
 * The one /api/friends fetch (#876). The panel renders it; the whole app
 * announces what changed in it — someone asking, someone accepting — the way
 * every other arrival announces itself (#568): cue, toast on a visible tab,
 * OS notification on a hidden one, once across tabs.
 *
 * Refreshed off the lobby ping (the layout drives it from presence.version),
 * so a request lands on the other side while they watch, not a minute later.
 */
import { api } from '$lib/api';
import { announce } from '$lib/messages/announce';
import { people } from '$lib/people.svelte';

export interface Friend {
	id: string;
	name: string;
	avatarUrl?: string;
	totalXp?: number;
	status: 'accepted' | 'pending_in' | 'pending_out';
	/** The friendship row's creation time — what dedupes the announcement. */
	at: number;
	online?: boolean;
	inRoom?: boolean;
	room?: string;
	roomName?: string;
}

/** An ask that was dismissed — a sentence for the rider who asked, nothing else. */
export interface Decline {
	id: string;
	name: string;
	at: number;
}

/** What a dismissal reads as (ADR-0012 amendment): the answer, not a verdict. */
export function declineEvent(decline: Decline): { tag: string; title: string } {
	return {
		tag: `friend-no-${decline.id}`,
		title: `${decline.name} dismissed your friend request`,
	};
}

/** One line to say, or nothing — the whole announceable difference between two lists. */
export function friendEvent(
	friend: Friend,
	was: Friend['status'] | undefined,
): { tag: string; title: string } | null {
	if (friend.status === 'pending_in' && !was)
		return {
			tag: `friend-req-${friend.id}`,
			title: `${friend.name} wants to be friends`,
		};
	if (friend.status === 'accepted' && was === 'pending_out')
		return {
			tag: `friend-ok-${friend.id}`,
			title: `${friend.name} accepted your friend request`,
		};
	// A dismissal has no row left to diff — the server carries it separately,
	// and declineEvent says it.
	return null;
}

let list = $state<Friend[] | null>(null);
let code = $state('');
let error = $state<string | null>(null);
// id → status at the previous refresh. The first answer is the state of the
// world, not a burst of arrivals (same rule as presence and the DM heads).
let before: Record<string, Friend['status']> | null = null;

async function refresh() {
	const res = await api<{
		friends: Friend[];
		code: string;
		declines: Decline[];
	}>('/api/friends');
	if (!res.ok) {
		error = res.error.message;
		return;
	}
	error = null;
	list = res.data.friends;
	code = res.data.code;
	people.learn(res.data.friends);

	const now: Record<string, Friend['status']> = {};
	for (const friend of res.data.friends) now[friend.id] = friend.status;
	if (before)
		for (const friend of res.data.friends) {
			const event = friendEvent(friend, before[friend.id]);
			if (!event) continue;
			announce({
				tag: event.tag,
				at: friend.at,
				title: event.title,
				body: '',
				href: '/friends',
				reading: false,
			});
		}
	before = now;

	// A dismissal needs no before/after: the server hands it over exactly once
	// it happened, and the tombstone's own time is what keeps it to one saying
	// — including on the device that was closed when it arrived.
	for (const decline of res.data.declines ?? []) {
		const event = declineEvent(decline);
		announce({
			tag: event.tag,
			at: decline.at,
			title: event.title,
			body: '',
			href: '/friends',
			reading: false,
		});
	}
}

export const friends = {
	/** Null until the first answer lands — a loading line, never a blank panel. */
	get list() {
		return list;
	},
	/**
	 * How many people are waiting on YOU (#1010). Deliberately not unread
	 * semantics: opening /friends does not clear it, because seeing a request
	 * is not answering one. It goes down when you accept or dismiss, which is
	 * when it stops being true.
	 */
	get waiting() {
		return (list ?? []).filter((f) => f.status === 'pending_in').length;
	},
	/** My own friend code: the thing I hand out so people can ask me. */
	get code() {
		return code;
	},
	get error() {
		return error;
	},
	// ponytail: one GET per presence ping, for every signed-in client — the
	// friends page already paid this, it is now everyone. A friends-only ping
	// (or the list riding along with the presence payload) when it shows.
	reload() {
		return refresh();
	},
};
