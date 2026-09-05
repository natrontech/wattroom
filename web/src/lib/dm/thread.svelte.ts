import { account } from '$lib/account.svelte';
import { api } from '$lib/api';
import { uploadImage } from '$lib/chat/upload';
import { dm } from '$lib/dm/dm.svelte';
import { dmHeads } from '$lib/dm/heads.svelte';
import { roomTimeline, type TimelineMessage } from '$lib/room/timeline';

/**
 * A DM thread's data (#672) — the same reactive-store shape as a room's
 * backlog read from outside (outside.svelte.ts): polled, not a live wire,
 * with a post going over HTTP and a merge-by-id on every page so the
 * millisecond-truncated `after` boundary can't duplicate a line. Unlike a
 * room, there is no reaction backend yet, and "read" stays purely the
 * reader's own business (ADR-0012 amended) — a localStorage stamp, never a
 * server fact — so `readAt` comes from there instead of a `GET .../read`.
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
		const res = await api<{ messages: DmLine[] }>(
			`/api/dms/${peerId}${after ? `?after=${after}` : ''}`,
		);
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
		close() {
			closed = true;
			if (timer) clearInterval(timer);
		},
	};
}
