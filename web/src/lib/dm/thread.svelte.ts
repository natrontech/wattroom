import { account } from '$lib/account.svelte';
import { api } from '$lib/api';
import { uploadImage } from '$lib/chat/upload';
import { dmHeads } from '$lib/dm/heads.svelte';
import type { ChatEdit, ChatReactionCount } from '$lib/protocol';
import { messageTimeline, type TimelineMessage } from '$lib/messages/timeline';

/**
 * A DM thread's data (#672, reactions in #777) — the same reactive-store
 * shape as a channel's thread (chat-thread.svelte.ts), but polled,
 * not a live wire, with a post going over HTTP and a merge-by-id on every
 * page so the millisecond-truncated `after` boundary can't duplicate a
 * line. Where the reader had read up to arrives with the first page and is
 * moved by `POST .../read` — the reader's own cursor, on every device they
 * use and never on the peer's (ADR-0012 amended, #2711).
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
	editedAt?: number;
	deletedAt?: number;
	/** When a temporary line runs out (#2644). */
	expiresAt?: number;
}

export function createDmThread(peerId: string, peerName: () => string) {
	let raw = $state<DmLine[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	// Taken from the first page, before this open marks the thread read —
	// the "N new" line marks what's new since the LAST time you had it open,
	// and must not creep down the list while you are reading it.
	let readAt = $state<number | null>(null);
	let reactions = $state<Record<string, Record<string, number>>>({});
	// "id:cheer" → I pressed it, same key shape chat-thread.svelte.ts uses.
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
			editedAt: m.editedAt,
			deletedAt: m.deletedAt,
			expiresAt: m.expiresAt,
		};
	}

	async function load(after: number) {
		const res = await api<{
			messages: DmLine[];
			reactions?: Record<string, Record<string, number>>;
			myReacts?: Record<string, string[]>;
			edits?: Record<string, ChatEdit>;
			deleted?: string[];
			readAt?: number;
		}>(`/api/dms/${peerId}${after ? `?after=${after}` : ''}`);
		if (closed) return;
		loading = false;
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		error = null;
		if (readAt === null) readAt = res.data.readAt ?? 0;
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
		// Edits cover the WHOLE pair for a second reason on top of the one
		// reactions have (#865): rewriting a line leaves its created_at
		// alone, so `after` can never bring the new text back with the
		// messages. Applied over whatever is loaded, on every poll.
		const edits = res.data.edits;
		if (edits && Object.keys(edits).length > 0) {
			raw = raw.map((m) => {
				const edit = edits[m.id];
				return edit && (m.text !== edit.text || m.editedAt !== edit.editedAt)
					? { ...m, text: edit.text, editedAt: edit.editedAt }
					: m;
			});
		}
		// Tombstones cover the WHOLE pair, like the edits above and for the
		// same reason (#2418): deleting leaves created_at alone, so `after`
		// can never bring the news back with the messages. A line the reader
		// is looking at goes to "Message deleted" on the next poll.
		const deleted = res.data.deleted;
		if (deleted?.length) {
			const gone = new Set(deleted);
			raw = raw.map((m) =>
				gone.has(m.id) && !m.deletedAt
					? { ...m, text: '', imageId: undefined, deletedAt: m.at }
					: m,
			);
		}
		if (raw.length > 0 && (fresh.length > 0 || !after)) {
			// Read only when you could actually have seen it — a thread left
			// open in a hidden tab must keep the badge (audit #219).
			if (!document.hidden) void markRead();
		}
	}

	async function markRead() {
		const res = await api(`/api/dms/${peerId}/read`, { method: 'POST' });
		// The badge comes off the heads: ask for them again, or a dot sits on
		// the thread you are reading until the next poll.
		if (res.ok) dmHeads.refresh();
	}

	/**
	 * Take back a line this rider sent (#2418). Sender only — there is no
	 * owner of a conversation. The poll carries the tombstone to the other
	 * side; this reload is what makes it appear here without waiting for the
	 * interval.
	 */
	async function remove(id: string): Promise<string | null> {
		const res = await api(`/api/dms/${peerId}/messages/${id}`, {
			method: 'DELETE',
		});
		if (!res.ok) return res.error.message;
		raw = raw.map((m) =>
			m.id === id ? { ...m, text: '', imageId: undefined, deletedAt: m.at } : m,
		);
		return null;
	}

	return {
		remove,
		canRemove: (message: { id?: string; fromId?: string }) =>
			message.fromId === account.me?.id,
		get timeline() {
			return messageTimeline(raw.map(toTimelineMessage));
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
		async send(
			text: string,
			image?: Blob,
			expiresIn?: number,
		): Promise<string | null> {
			let imageId: string | undefined;
			if (image) {
				const up = await uploadImage(`/api/dms/${peerId}/images`, image);
				if (!up.ok) return up.error.message;
				imageId = up.data.id;
			}
			const res = await api(`/api/dms/${peerId}`, {
				method: 'POST',
				json: { text, imageId, expiresIn },
			});
			if (!res.ok) return res.error.message;
			await load(raw.at(-1)?.at ?? 0);
			return null;
		},
		/** Rewrite one of my messages (#865); the peer sees it on their poll. */
		async edit(id: string, text: string): Promise<string | null> {
			const res = await api<ChatEdit>(`/api/dms/${peerId}/messages/${id}`, {
				method: 'PATCH',
				json: { text },
			});
			if (!res.ok) return res.error.message;
			raw = raw.map((m) =>
				m.id === id
					? { ...m, text: res.data.text, editedAt: res.data.editedAt }
					: m,
			);
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
