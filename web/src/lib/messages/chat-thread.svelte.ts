import { api } from '$lib/api';
import { uploadImage } from '$lib/chat/upload';
import { presence } from '$lib/presence.svelte';
import type {
	ChatEdit,
	ChatLine,
	ChatReactionCount,
	SessionRecap,
} from '$lib/protocol';
import type { Announcement } from '$lib/room/room-data';

/**
 * One chat read and written over HTTP — a text channel's (#2448), or a room's
 * read from outside it (#468) until the room goes (#2460). No socket: chat
 * left the tick (#2437), so the backlog is the whole truth and is read again
 * whenever the caller hears the lobby ping. `base` is the API the thread
 * lives under: `/api/channels/{id}` or `/api/rooms/{slug}`.
 */
interface BacklogMessage extends ChatLine {
	id: string;
	reactions?: Record<string, number>;
	mine?: string[];
}

export function createChatThread(base: string) {
	let messages = $state<ChatLine[]>([]);
	let recaps = $state<SessionRecap[]>([]);
	let announcement = $state<Announcement | null>(null);
	let reactions = $state<Record<string, Record<string, number>>>({});
	let myReacts = $state<Record<string, boolean>>({});
	// Where you had read up to when this thread opened — the "N new" line
	// sits above the first message past it, and stays put while you read.
	let readAt = $state<number | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let closed = false;
	// Reads overlap on a busy lobby; only the newest may land, or an older
	// answer would put back a line that has since been deleted.
	let issued = 0;

	async function load() {
		const mine = ++issued;
		const res = await api<{
			messages: BacklogMessage[];
			readAt: number;
			recaps?: SessionRecap[];
			announcement?: Announcement;
		}>(`${base}/chat`);
		if (closed || mine !== issued) return;
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
		// A room's finished sessions ride its backlog (ADR-0034); a text
		// channel has none, and carries its marked line instead (#2435).
		recaps = res.data.recaps ?? [];
		announcement = res.data.announcement ?? null;
		// Reading is what clears the badge — only when you could actually
		// have read it: a thread left open in a hidden tab keeps its count.
		if ((first || fresh) && !document.hidden) void markRead();
	}

	async function markRead() {
		const res = await api(`${base}/read`, { method: 'POST' });
		// The sidebar's count comes off the lobby's list: ask for it again,
		// or a "1" sits on the thread you are reading until the next ping.
		if (res.ok) presence.reload();
	}

	const onVisible = () => {
		if (!document.hidden && messages.length > 0) void markRead();
	};

	return {
		get recaps() {
			return recaps;
		},
		get messages() {
			return messages;
		},
		get announcement() {
			return announcement;
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
		start() {
			void load();
			document.addEventListener('visibilitychange', onVisible);
		},
		/** Read the backlog again — on the lobby ping, and after a write. */
		reload() {
			void load();
		},
		/** Try again after a failed load — the retry button's whole job. */
		retry() {
			loading = true;
			void load();
		},
		/** Returns the refusal, or null once the line is in the thread. */
		async send(text: string, image?: Blob): Promise<string | null> {
			let imageId: string | undefined;
			if (image) {
				const up = await uploadImage(`${base}/chat/images`, image);
				if (!up.ok) return up.error.message;
				imageId = up.data.id;
			}
			const res = await api<ChatLine>(`${base}/chat`, {
				method: 'POST',
				json: { text, imageId },
			});
			if (!res.ok) return res.error.message;
			// Straight into the log: the lobby ping brings it too, a beat
			// later, and the sender should not wait to see their own words.
			if (!messages.some((m) => m.id === res.data.id))
				messages = [...messages, res.data];
			return null;
		},
		/** Rewrite one of my lines (#865). */
		async edit(id: string, text: string): Promise<string | null> {
			const res = await api<ChatEdit>(`${base}/chat/${id}`, {
				method: 'PATCH',
				json: { text },
			});
			if (!res.ok) return res.error.message;
			messages = messages.map((m) =>
				m.id === id
					? { ...m, text: res.data.text, editedAt: res.data.editedAt }
					: m,
			);
			return null;
		},
		/** Take a line out for good (#2417). */
		async remove(id: string): Promise<string | null> {
			const res = await api(`${base}/chat/${id}`, { method: 'DELETE' });
			if (!res.ok) return res.error.message;
			messages = messages.filter((m) => m.id !== id);
			return null;
		},
		/** Toggle my reaction — optimistic; the answer corrects the count. */
		async react(id: string, cheer: string): Promise<string | null> {
			const key = `${id}:${cheer}`;
			const was = !!myReacts[key];
			myReacts = { ...myReacts, [key]: !was };
			const res = await api<ChatReactionCount>(`${base}/chat/reactions`, {
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
			document.removeEventListener('visibilitychange', onVisible);
		},
	};
}

export type ChatThread = ReturnType<typeof createChatThread>;
