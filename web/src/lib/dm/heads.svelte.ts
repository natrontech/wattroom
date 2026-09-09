/**
 * DM conversation heads, polled GLOBALLY (audit #219): the blip, the
 * hidden-tab notification and the unread badges must work while you sit in
 * a room — which is where riders actually are — not only on the two pages
 * that happened to mount the friends panel. Started once from the layout.
 */
import { untrack } from 'svelte';
import { api } from '$lib/api';
import { dm } from '$lib/dm/dm.svelte';
import { announce } from '$lib/messages/announce';
import { away } from '$lib/notify.svelte';
import { people } from '$lib/people.svelte';

export interface DmHead {
	peerId: string;
	peerName: string;
	peerAvatarUrl?: string;
	peerTotalXp?: number;
	text: string;
	/** The latest line was an image (#285) — it has no text to preview. */
	hasImage?: boolean;
	mine: boolean;
	at: number;
}

/** What a conversation's latest line reads as; an image has no words. */
export function headPreview(head: DmHead): string {
	if (head.text) return head.text;
	return head.hasImage ? 'sent an image' : '';
}

let heads = $state<DmHead[]>([]);
// peerId → newest INBOUND message time. A reply of yours becoming the head
// must not clear the badge for an unread line beneath it.
let inbound = $state<Record<string, number>>({});
let seenBump = $state(0);
// The list's own two states (#1816): a refused poll used to be dropped on
// the floor, and /messages rendered "no conversations" over a 500.
let loaded = $state(false);
let error = $state<string | null>(null);
let started = false;
let first = true;
let timer: ReturnType<typeof setInterval> | undefined;

async function poll() {
	const res = await api<{ conversations: DmHead[] }>('/api/dms');
	loaded = true;
	if (!res.ok) {
		error = res.error.message;
		return;
	}
	error = null;
	heads = [...res.data.conversations].sort((a, b) => b.at - a.at);
	// The faces a chat line cannot carry (#807) — learned from the poll that
	// already fetched them, never a fetch of their own.
	people.learn(
		res.data.conversations.map((head) => ({
			id: head.peerId,
			name: head.peerName,
			avatarUrl: head.peerAvatarUrl,
			totalXp: head.peerTotalXp,
		})),
	);
	const next = { ...inbound };
	for (const head of res.data.conversations) {
		if (head.mine) continue;
		const known = next[head.peerId] ?? 0;
		if (head.at <= known) continue;
		next[head.peerId] = head.at;
		// A NEW inbound line, announced the one way every message is (#568).
		if (first) continue;
		announce({
			tag: `dm-${head.peerId}`,
			at: head.at,
			title: head.peerName,
			body: headPreview(head),
			href: `/messages/dm/${head.peerId}`,
			reply: {
				placeholder: `Reply to ${head.peerName}`,
				send: (text) =>
					api(`/api/dms/${head.peerId}`, { method: 'POST', json: { text } }),
			},
			reading: dm.open?.id === head.peerId && !away(),
		});
	}
	inbound = next;
	first = false;
}

export const dmHeads = {
	get heads() {
		return heads;
	},
	/** The first answer arrived, refused or not — the skeleton's cue. */
	get loaded() {
		return loaded;
	},
	/** Why the list is not to be trusted right now; null while it is. */
	get error() {
		return error;
	},
	/** The retry button's whole job. */
	retry() {
		void poll();
	},
	/** Idempotent; the layout calls it while a rider is signed in. */
	start() {
		if (started || typeof window === 'undefined') return;
		started = true;
		void poll();
		timer = setInterval(() => void poll(), 10_000);
	},
	/**
	 * On sign-out (#1515): the poll used to outlive the session — six 401s a
	 * minute for the life of the tab — and its badges outlived the rider.
	 */
	stop() {
		clearInterval(timer);
		timer = undefined;
		started = false;
		first = true;
		loaded = false;
		error = null;
		heads = [];
		inbound = {};
	},
	unread(peerId: string): boolean {
		void seenBump; // re-check after a thread open stamps it seen
		return (inbound[peerId] ?? 0) > dm.seenAt(peerId);
	},
	/** Call after opening/stamping a thread so badges re-evaluate. */
	bump() {
		// Called from the thread page's effect: `+= 1` READS the counter too,
		// which made that effect depend on the thing it writes — an infinite
		// loop on every DM open (#414, same shape as #408).
		untrack(() => (seenBump += 1));
	},
};
