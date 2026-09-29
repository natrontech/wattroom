/**
 * DM conversation heads, kept GLOBALLY (audit #219): the blip, the hidden-tab
 * notification and the unread badges must work while you sit in a voice channel
 * — which is where riders actually are — not only on the two pages that
 * happened to mount the friends panel. Started once from the layout.
 *
 * They follow the lobby ping (#2937): a line, an edit, a reaction or a poke
 * pings both riders' sockets, and a read pings the reader's own. It used to be
 * a 10 s poll from every tab — six reads a minute on a session page mid-ride,
 * for a list that almost never changes. The poll is now only the fallback.
 */
import { api } from '$lib/api';
import { dm } from '$lib/dm/dm.svelte';
import { announce } from '$lib/messages/announce';
import { away } from '$lib/notify.svelte';
import { people } from '$lib/people.svelte';
import { dmReply, pokeArrival, pokeFriend } from '$lib/poke';
import type { StatusLine } from '$lib/protocol';
import { titleWithStatus } from '$lib/status-line/title';

export interface DmHead {
	peerId: string;
	peerName: string;
	peerAvatarUrl?: string;
	peerTotalXp?: number;
	/** Their status line (ADR-0060); null for none. */
	peerStatusLine?: StatusLine | null;
	text: string;
	/** The latest line was an image (#285) — it has no text to preview. */
	hasImage?: boolean;
	/** The latest line is a poke (#2721); `text` is what came with it. */
	poke?: boolean;
	mine: boolean;
	at: number;
	/**
	 * The peer said something since you last read the thread, on any
	 * device (#2711) — the server's answer, asked of the whole thread.
	 */
	unread?: boolean;
}

/** What a conversation's latest line reads as; an image has no words. */
export function headPreview(head: DmHead): string {
	if (head.poke) {
		const verb = head.mine ? `poked ${head.peerName}` : 'poked you';
		return head.text ? `${verb} — ${head.text}` : verb;
	}
	if (head.text) return head.text;
	return head.hasImage ? 'sent an image' : '';
}

let heads = $state<DmHead[]>([]);
// peerId → newest INBOUND message time the poll has seen: what tells a new
// line, to be announced, from one already announced.
let inbound = $state<Record<string, number>>({});
// The list's own two states (#1816): a refused poll used to be dropped on
// the floor, and /messages rendered "no conversations" over a 500.
let loaded = $state(false);
let error = $state<string | null>(null);
let started = false;
let first = true;
let timer: ReturnType<typeof setInterval> | undefined;
// The lobby ping's count this list last answered; null until the layout
// first reports one, which is the count start() already fetched against.
let heardVersion: number | null = null;
let lastPoll = 0;

/**
 * How stale the list may get when no ping arrives — a dead socket, or a page
 * with no lobby. The presence feed re-reads on this beat too, and each of its
 * reads pings the list, so this fires only when that feed is not running.
 */
export const FALLBACK_MS = 60_000;

async function poll() {
	lastPoll = Date.now();
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
			statusLine: head.peerStatusLine,
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
		// A poke the hub may already have tapped live: same tag, same moment,
		// so this finds it announced (#2721).
		if (head.poke) {
			announce(
				pokeArrival(
					{ ...head, fromId: head.peerId, from: head.peerName, dm: true },
					() => void pokeFriend(head.peerId, head.peerName),
				),
			);
			continue;
		}
		announce({
			kind: 'dm',
			tag: `dm-${head.peerId}`,
			at: head.at,
			title: titleWithStatus(head.peerName, head.peerStatusLine),
			body: headPreview(head),
			href: `/messages/dm/${head.peerId}`,
			reply: dmReply(head.peerId, head.peerName),
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
		timer = setInterval(() => {
			if (Date.now() - lastPoll >= FALLBACK_MS) void poll();
		}, FALLBACK_MS / 2);
	},
	/**
	 * The lobby ping's count, from the layout: a change is a ping, so ask
	 * again. The first count seen is the one start() already answered.
	 */
	follow(version: number) {
		if (heardVersion !== null && version !== heardVersion) void poll();
		heardVersion = version;
	},
	/**
	 * On sign-out (#1515): the poll used to outlive the session — six 401s a
	 * minute for the life of the tab — and its badges outlived the rider.
	 */
	stop() {
		clearInterval(timer);
		timer = undefined;
		heardVersion = null;
		started = false;
		first = true;
		loaded = false;
		error = null;
		heads = [];
		inbound = {};
	},
	unread(peerId: string): boolean {
		return heads.some((head) => head.peerId === peerId && head.unread);
	},
	/** Ask again now — after a read, so the badge clears ahead of the poll. */
	refresh() {
		void poll();
	},
};
