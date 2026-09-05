import { account } from '$lib/account.svelte';
import { api } from '$lib/api';
import { uploadImage } from '$lib/chat/upload';
import { dm } from '$lib/dm/dm.svelte';
import { dmHeads } from '$lib/dm/heads.svelte';
import type { ChatReactionCount } from '$lib/protocol';
import { roomTimeline, type TimelineMessage } from '$lib/room/timeline';

/**
 * A DM thread's data (#672, reactions in #777) — the same reactive-store
 * shape as a room's backlog read from outside (outside.svelte.ts): polled,
 * not a live wire, with a post going over HTTP and a merge-by-id on every
 * page so the millisecond-truncated `after` boundary can't duplicate a
 * line. "read" stays purely the reader's own business (ADR-0012 amended) —
 * a localStorage stamp, never a server fact — so `readAt` comes from there
 * instead of a `GET .../read`.
 *
 * Reactions ride separately from the incremental `after` fetch: the server
 * returns the pair's FULL current reaction map on every poll (not scoped to
 * the messages that poll happened to bring back), because a reaction on a
 * message already loaded here would otherwise never surface — `after`
 * excludes it from `messages` on every later page.
 */
export const POLL_MS = 5_000;

interface DmLine {
	id: string;
	mine: boolean;
	text: string;
	imageId?: string;
	at: number;
}

export function createDmThread(peerId: string, peerName: () => string) {
	let raw = $state<DmLine[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	// Captured now, before the page marks this thread seen — the "N new"
	// line marks what's new since the LAST time you had it open, and must
	// not creep down the list while you are reading it.
	let readAt = $state<number | null>(dm.seenAt(peerId));
	let reactions = $state<Record<string, Record<string, number>>>({});
	// "id:cheer" → I pressed it, same key shape outside.svelte.ts uses.
	let myReacts = $state<Record<string, boolean>>({});
	let timer: ReturnType<typeof setInterval> | null = null;
	let closed = false;

	function toTimelineMessage(m: DmLine): TimelineMessage {
		return {
			id: m.id,
			from: m.mine ? 'You' : peerName(),
			fromId: m.mine ? account.me?.id : peerId,
			text: m.text,
			imageId: m.imageId,
			at: m.at,
		};
	}

	async function load(after: number) {
		const res = await api<{
			messages: DmLine[];
			reactions?: Record<string, Record<string, number>>;
			myReacts?: Record<string, string[]>;
		}>(`/api/dms/${peerId}${after ? `?after=${after}` : ''}`);
		if (closed) return;
		loading = false;
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		error = null;
		// `after` is millisecond-truncated, so the boundary message can come
		// back — merge by id, never blind-append.
		const seen = new Set(raw.map((m) => m.id));
		const fresh = res.data.messages.filter((m) => !seen.has(m.id));
		if (!after) raw = res.data.messages;
		else if (fresh.length > 0) raw = [...raw, ...fresh];
		// Reactions cover the WHOLE pair, not just this page's messages
		// (server-side note in dms.go's handleThread) — replaced wholesale
		// on every poll, so a reaction on an already-loaded message still
		// surfaces even though `after` kept it out of `messages` here.
		reactions = res.data.reactions ?? {};
		const pressed: Record<string, boolean> = {};
		for (const [id, cheers] of Object.entries(res.data.myReacts ?? {})) {
			for (const cheer of cheers) pressed[`${id}:${cheer}`] = true;
		}
		myReacts = pressed;
		if (raw.length > 0 && (fresh.length > 0 || !after)) {
			// "Seen" only when you could actually have seen it — a thread left
			// open in a hidden tab must keep the badge (audit #219).
			if (!document.hidden) {
				dm.stampSeen(peerId);
				dmHeads.bump();
			}
		}
	}

	return {
		get timeline() {
			return roomTimeline(raw.map(toTimelineMessage), []);
		},
		get readAt() {
			return readAt;
		},
		get loading() {
			return loading;
		},
		get error() {
			return error;
		},
		get reactions() {
			return reactions;
		},
		get myReacts() {
			return myReacts;
		},
		/** Polled, not a live wire: a note between rides (ADR-0012 amended). */
		start() {
			void load(0);
			timer = setInterval(() => void load(raw.at(-1)?.at ?? 0), POLL_MS);
		},
		/** Try again after a failed load — the retry button's whole job. */
		retry() {
			loading = true;
			void load(0);
		},
		/** Returns the refusal, or null once the line is in the thread. */
		async send(text: string, image?: Blob): Promise<string | null> {
			let imageId: string | undefined;
			if (image) {
				const up = await uploadImage(`/api/dms/${peerId}/images`, image);
				if (!up.ok) return up.error.message;
				imageId = up.data.id;
			}
			const res = await api(`/api/dms/${peerId}`, {
				method: 'POST',
				json: { text, imageId },
			});
			if (!res.ok) return res.error.message;
			await load(raw.at(-1)?.at ?? 0);
			return null;
		},
		/** Toggle my reaction — optimistic; the answer corrects the count. */
		async react(id: string, cheer: string): Promise<string | null> {
			const key = `${id}:${cheer}`;
			const was = !!myReacts[key];
			myReacts = { ...myReacts, [key]: !was };
			const res = await api<ChatReactionCount>(`/api/dms/${peerId}/reactions`, {
				method: 'POST',
				json: { messageId: id, emoji: cheer },
			});
			if (!res.ok) {
				myReacts = { ...myReacts, [key]: was };
				return res.error.message;
			}
			reactions = {
				...reactions,
				[id]: { ...reactions[id], [cheer]: res.data.count },
			};
			myReacts = { ...myReacts, [key]: res.data.added };
			return null;
		},
		close() {
			closed = true;
			if (timer) clearInterval(timer);
		},
	};
}
