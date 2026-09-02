import { api } from '$lib/api';
import { uploadImage } from '$lib/chat/upload';
import { presence } from '$lib/presence.svelte';
import type { ChatLine, ChatReactionCount } from '$lib/protocol';

/**
 * A room's chat read from OUTSIDE the room (#468): no socket, no voice, no
 * ride — the backlog polled the way a DM is, posts over HTTP, and the hub
 * hands both to whoever is inside. The room connection is the live twin of
 * this; a thread shows one or the other depending on where you stand.
 */
export const POLL_MS = 5_000;

interface BacklogMessage extends ChatLine {
	id: string;
	reactions?: Record<string, number>;
	mine?: string[];
}

export function createOutsideThread(slug: string) {
	let messages = $state<ChatLine[]>([]);
	let reactions = $state<Record<string, Record<string, number>>>({});
	let myReacts = $state<Record<string, boolean>>({});
	// Where you had read up to when this thread opened — the "N new" line
	// sits above the first message past it, and stays put while you read.
	let readAt = $state<number | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let timer: ReturnType<typeof setInterval> | null = null;
	let closed = false;

	async function load() {
		const res = await api<{ messages: BacklogMessage[]; readAt: number }>(
			`/api/rooms/${slug}/chat`,
		);
		if (closed) return;
		loading = false;
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		error = null;
		const first = readAt === null;
		if (first) readAt = res.data.readAt ?? 0;
		const had = new Set(messages.map((m) => m.id));
		const fresh = res.data.messages.some((m) => !had.has(m.id));
		// The backlog is the whole truth from out here — counts included, so
		// a reaction someone inside added shows up on the next poll.
		const counts: Record<string, Record<string, number>> = {};
		const pressed: Record<string, boolean> = {};
		for (const m of res.data.messages) {
			if (m.reactions) counts[m.id] = m.reactions;
			for (const cheer of m.mine ?? []) pressed[`${m.id}:${cheer}`] = true;
		}
		messages = res.data.messages.map(
			({ reactions: _r, mine: _m, ...line }) => line,
		);
		reactions = counts;
		myReacts = pressed;
		// Reading is what clears the badge — only when you could actually
		// have read it: a thread left open in a hidden tab keeps its count.
		if ((first || fresh) && !document.hidden) void markRead();
	}

	async function markRead() {
		const res = await api(`/api/rooms/${slug}/read`, { method: 'POST' });
		// The sidebar's count comes off the rooms list, which nothing pings
		// for a chat line: ask for it again, or a "1" sits on the room you
		// are reading until the next poll.
		if (res.ok) presence.reload();
	}

	const onVisible = () => {
		if (!document.hidden && messages.length > 0) void markRead();
	};

	return {
		get messages() {
			return messages;
		},
		get reactions() {
			return reactions;
		},
		get myReacts() {
			return myReacts;
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
		/** Polled, not a live wire: you are not in the room. */
		start() {
			void load();
			timer = setInterval(() => void load(), POLL_MS);
			document.addEventListener('visibilitychange', onVisible);
		},
		/** Try again after a failed load — the retry button's whole job. */
		retry() {
			loading = true;
			void load();
		},
		/** Returns the refusal, or null once the line is in the room. */
		async send(text: string, image?: Blob): Promise<string | null> {
			let imageId: string | undefined;
			if (image) {
				const up = await uploadImage(`/api/rooms/${slug}/chat/images`, image);
				if (!up.ok) return up.error.message;
				imageId = up.data.id;
			}
			const res = await api<ChatLine>(`/api/rooms/${slug}/chat`, {
				method: 'POST',
				json: { text, imageId },
			});
			if (!res.ok) return res.error.message;
			// Straight into the log — the next poll would bring it anyway,
			// but five seconds is a long time to wonder whether Send worked.
			if (!messages.some((m) => m.id === res.data.id))
				messages = [...messages, res.data];
			return null;
		},
		/** Toggle my reaction — optimistic; the answer corrects the count. */
		async react(id: string, cheer: string): Promise<string | null> {
			const key = `${id}:${cheer}`;
			const was = !!myReacts[key];
			myReacts = { ...myReacts, [key]: !was };
			const res = await api<ChatReactionCount>(
				`/api/rooms/${slug}/chat/reactions`,
				{ method: 'POST', json: { messageId: id, emoji: cheer } },
			);
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
			document.removeEventListener('visibilitychange', onVisible);
		},
	};
}
