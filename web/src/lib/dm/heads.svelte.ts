/**
 * DM conversation heads, polled GLOBALLY (audit #219): the blip, the
 * hidden-tab notification and the unread badges must work while you sit in
 * a room — which is where riders actually are — not only on the two pages
 * that happened to mount the friends panel. Started once from the layout.
 */
import { untrack } from 'svelte';
import { api } from '$lib/api';
import { dm } from '$lib/dm/dm.svelte';
import { notify } from '$lib/notify.svelte';
import { play } from '$lib/sound/cues';
import { shouldAnnounce } from '$lib/notify-once';

export interface DmHead {
	peerId: string;
	peerName: string;
	peerAvatarUrl?: string;
	peerAvatarPreset?: string;
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
	return head.hasImage ? 'Sent an image' : '';
}

let heads = $state<DmHead[]>([]);
// peerId → newest INBOUND message time. A reply of yours becoming the head
// must not clear the badge for an unread line beneath it.
let inbound = $state<Record<string, number>>({});
let seenBump = $state(0);
let started = false;
let first = true;

async function poll() {
	const res = await api<{ conversations: DmHead[] }>('/api/dms');
	if (!res.ok) return;
	heads = [...res.data.conversations].sort((a, b) => b.at - a.at);
	const next = { ...inbound };
	for (const head of res.data.conversations) {
		if (head.mine) continue;
		const known = next[head.peerId] ?? 0;
		if (head.at <= known) continue;
		next[head.peerId] = head.at;
		// A NEW inbound line: blip + hidden-tab alert — unless that thread is
		// open in a visible tab right now.
		const reading = dm.open?.id === head.peerId && !document.hidden;
		if (!first && !reading && shouldAnnounce(`dm-${head.peerId}`, head.at)) {
			play('chat');
			notify.push(head.peerName, headPreview(head), `dm-${head.peerId}`);
		}
	}
	inbound = next;
	first = false;
}

export const dmHeads = {
	get heads() {
		return heads;
	},
	/** Idempotent; the layout calls it once per app load. */
	start() {
		if (started || typeof window === 'undefined') return;
		started = true;
		void poll();
		setInterval(() => void poll(), 10_000);
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
