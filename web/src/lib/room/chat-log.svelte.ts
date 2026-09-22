import type { ChatLine } from '$lib/protocol';
import { play } from '$lib/sound/cues';

/**
 * The room's chat as this client holds it: the backlog, read over HTTP and
 * read again on every lobby ping (#2437 — chat left the tick). The backlog
 * is the whole truth, counts included, so each read replaces what was here:
 * a line edited or deleted anywhere reads that way on the next one.
 */
export type BacklogMessage = {
	id: string;
	from: string;
	fromId?: string;
	text: string;
	imageId?: string;
	at: number;
	editedAt?: number;
	reactions?: Record<string, number>;
	mine?: string[];
};

/** The log's bound — the server's backlog is longer; the pane never was. */
const KEEP = 200;

export function createChatLog() {
	let chatLog = $state<ChatLine[]>([]);
	// messageId → emoji → count.
	let chatReactions = $state<Record<string, Record<string, number>>>({});
	// "did I press it", keyed id:emoji.
	let myReacts = $state<Record<string, boolean>>({});
	let seeded = false;

	/** One read of the backlog — replaces the log and the counts. */
	function seed(messages: BacklogMessage[]) {
		const counts: Record<string, Record<string, number>> = {};
		const pressed: Record<string, boolean> = {};
		for (const m of messages) {
			if (m.reactions) counts[m.id] = m.reactions;
			for (const emoji of m.mine ?? []) pressed[`${m.id}:${emoji}`] = true;
		}
		// Someone too gassed to type still said something (#834): a count
		// that rose on a reaction I do not hold is somebody else's. Not on
		// the first read — that is the state of the room, not news.
		if (seeded && reactedByOthers(chatReactions, counts, pressed)) {
			play('reaction');
		}
		seeded = true;
		chatLog = [...messages]
			.sort((a, b) => a.at - b.at)
			.slice(-KEEP)
			.map(({ reactions: _r, mine: _m, ...line }) => line);
		chatReactions = counts;
		myReacts = pressed;
	}

	/** My own press, ahead of the answer (#219). */
	function toggleMine(messageId: string, emoji: string) {
		const key = `${messageId}:${emoji}`;
		myReacts = { ...myReacts, [key]: !myReacts[key] };
	}

	return {
		get log() {
			return chatLog;
		},
		get reactions() {
			return chatReactions;
		},
		get myReacts() {
			return myReacts;
		},
		seed,
		toggleMine,
	};
}

/** Whether any count rose on a reaction the reader does not hold. */
export function reactedByOthers(
	before: Record<string, Record<string, number>>,
	after: Record<string, Record<string, number>>,
	mine: Record<string, boolean>,
): boolean {
	for (const [id, emojis] of Object.entries(after)) {
		for (const [emoji, count] of Object.entries(emojis)) {
			if (count > (before[id]?.[emoji] ?? 0) && !mine[`${id}:${emoji}`])
				return true;
		}
	}
	return false;
}
