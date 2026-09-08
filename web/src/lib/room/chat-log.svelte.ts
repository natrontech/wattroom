import { account } from '$lib/account.svelte';
import type { ChatEdit, ChatLine, ServerTick } from '$lib/protocol';
import { play } from '$lib/sound/cues';

/**
 * The room's chat as this client holds it: a bounded log seeded by the
 * join-time backlog with live lines riding the tick on top (ADR-0010
 * amended, #201), the ids the async save assigns after the fact (#219), the
 * edits that may outrun those ids (#1231), and the reactions. Split from
 * live.svelte.ts, which owns the socket and hands every tick here.
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

export function createChatLog() {
	// Chat is a bounded room log since ADR-0010's amendment (#201): the
	// backlog seeds it on join, live lines ride the tick on top.
	let chatLog = $state<ChatLine[]>([]);
	// messageId → emoji → count, shared truth from the tick + backlog.
	let chatReactions = $state<Record<string, Record<string, number>>>({});
	// "did I press it" — the client's own knowledge, keyed id:emoji.
	let myReacts = $state<Record<string, boolean>>({});
	// Ids the async save assigned (#219), keyed fromId:at, waiting for their
	// line — usually applied the moment they arrive, kept only when a flood
	// carries the line to a later tick than its id.
	let pendingIds: Record<string, string> = {};
	/**
	 * What names a line before and after its save: its id once it has one,
	 * and the author + server time the id announcement is keyed by (#219).
	 * The backlog and the tick can each carry the same line, and only one of
	 * the two copies knows the id (#1231).
	 */
	function lineKeys(line: {
		id?: string;
		fromId?: string;
		at: number;
	}): string[] {
		const keys: string[] = [];
		if (line.id) keys.push(line.id);
		if (line.fromId) keys.push(`${line.fromId}:${line.at}`);
		return keys;
	}
	// Edits that named an id no line here carries yet (#1231): the save runs
	// off the read loop, so a line's id follows in a later tick, and an author
	// can edit inside that gap. Held until the id lands, like pendingIds.
	let pendingEdits: Record<string, ChatEdit> = {};
	/** Land every held edit whose line now has its id; keep the rest. */
	function applyPendingEdits() {
		const ids = Object.keys(pendingEdits);
		if (ids.length === 0) return;
		chatLog = chatLog.map((line) => {
			const edit = line.id ? pendingEdits[line.id] : undefined;
			if (!edit) return line;
			delete pendingEdits[line.id!];
			return { ...line, text: edit.text, editedAt: edit.editedAt };
		});
		// An edit whose line never surfaces (pruned, or never ours) must not
		// pool forever.
		if (Object.keys(pendingEdits).length > 64) pendingEdits = {};
	}

	function onTick(tick: ServerTick) {
		if (tick.chatIds?.length) {
			// The save happens off the server's read loop (#219): lines
			// arrive id-less, their persisted id follows here and turns
			// reactions on for them.
			for (const assigned of tick.chatIds) {
				pendingIds[`${assigned.fromId}:${assigned.at}`] = assigned.id;
			}
		}
		if (tick.chat?.length) {
			// A line may already be here from the backlog fetch that raced
			// the tick (#468, #1231): by id when it was posted from outside
			// the room, by author and time when posted from inside — the
			// tick's copy has no id yet. One line, once.
			const have = new Set(chatLog.flatMap(lineKeys));
			const fresh = tick.chat.filter(
				(line) => !lineKeys(line).some((k) => have.has(k)),
			);
			if (fresh.length > 0) chatLog = [...chatLog, ...fresh].slice(-200);
		}
		if (Object.keys(pendingIds).length > 0) {
			chatLog = chatLog.map((line) => {
				const key = `${line.fromId}:${line.at}`;
				const id = pendingIds[key];
				if (!id) return line;
				delete pendingIds[key];
				// The backlog may have named it first (#1231).
				return line.id ? line : { ...line, id };
			});
			// An id whose line never surfaced (pruned by the 200-line cap)
			// would pool forever — reset the stragglers.
			if (Object.keys(pendingIds).length > 64) pendingIds = {};
			applyPendingEdits();
		}
		if (tick.chatEdits?.length) {
			// A rewritten line lands ON the line already in the log
			// (#865) — never as a second message, which is the whole
			// point of editing rather than posting a correction.
			const byId = new Map(
				tick.chatEdits.map((edit) => [edit.messageId, edit]),
			);
			chatLog = chatLog.map((line) => {
				const edit = line.id ? byId.get(line.id) : undefined;
				if (edit) byId.delete(line.id!);
				return edit
					? { ...line, text: edit.text, editedAt: edit.editedAt }
					: line;
			});
			// Whatever found no line yet waits for its id (#1231).
			for (const [id, edit] of byId) pendingEdits[id] = edit;
		}
		if (tick.chatReactions?.length) {
			const next = { ...chatReactions };
			const pressed = { ...myReacts };
			let mineChanged = false;
			// Someone too gassed to type still said something (#834):
			// the feel layer's quick-reaction cue, which had been
			// written and never played. Added only — taking one back
			// is not an announcement — and never your own.
			if (
				tick.chatReactions.some(
					(change) => change.added && change.by !== account.me?.id,
				)
			)
				play('reaction');
			for (const change of tick.chatReactions) {
				next[change.messageId] = {
					...next[change.messageId],
					[change.emoji]: change.count,
				};
				// The server echoes the actor: my own tabs reconcile the
				// highlight from truth, not from the click (#219).
				if (change.by && change.by === account.me?.id) {
					pressed[`${change.messageId}:${change.emoji}`] = change.added;
					mineChanged = true;
				}
			}
			chatReactions = next;
			if (mineChanged) myReacts = pressed;
		}
	}

	/** The join-time backlog (#201) — merges under the live lines, seeds reactions. */
	function seed(messages: BacklogMessage[]) {
		// Live lines may land before the backlog resolves; the seed merges
		// UNDER them by id — replacing wholesale ate the first seconds of a
		// conversation (audit #219). Live reaction counts stay authoritative.
		// ...but a line we already hold still has to take an edit we
		// missed (#1082). The edit fan-out rides one tick and is never
		// re-sent, so a rider whose socket flapped across it never saw the
		// new words, and this reseed is the only thing left that can say
		// so. Skipping every known id — which is what merging UNDER them
		// meant — left the stale line on screen until a full reload.
		//
		// editedAt is the version, so this cannot undo the race above: a
		// live edit that landed while the fetch was in flight is newer
		// than the backlog's copy and stays.
		//
		// A live line not yet told its id is the backlog's line by author
		// and time (#1231); it takes the id here rather than a twin.
		const seeded = new Map(
			messages.flatMap((m) => lineKeys(m).map((k) => [k, m] as const)),
		);
		const held = new Set<string>();
		chatLog = chatLog.map((line) => {
			const m = lineKeys(line)
				.map((k) => seeded.get(k))
				.find(Boolean);
			if (!m) return line;
			held.add(m.id);
			const named = line.id ? line : { ...line, id: m.id };
			return (m.editedAt ?? 0) > (named.editedAt ?? 0)
				? { ...named, text: m.text, editedAt: m.editedAt }
				: named;
		});

		chatLog = [
			...messages
				.filter((m) => !held.has(m.id))
				.map((m) => ({
					id: m.id,
					from: m.from,
					fromId: m.fromId,
					text: m.text,
					imageId: m.imageId,
					at: m.at,
					// Without this a rider who joins after the fix sees the
					// new words with no sign they are new ones (#865).
					editedAt: m.editedAt,
				})),
			...chatLog,
		]
			.sort((a, b) => a.at - b.at)
			.slice(-200);
		const counts: Record<string, Record<string, number>> = {
			...chatReactions,
		};
		const pressed: Record<string, boolean> = { ...myReacts };
		for (const m of messages) {
			if (m.reactions && !counts[m.id]) counts[m.id] = m.reactions;
			for (const emoji of m.mine ?? []) pressed[`${m.id}:${emoji}`] = true;
		}
		chatReactions = counts;
		myReacts = pressed;
	}

	/** My own press, before the tick confirms it (#219). */
	function toggleMine(messageId: string, emoji: string) {
		myReacts = {
			...myReacts,
			[`${messageId}:${emoji}`]: !myReacts[`${messageId}:${emoji}`],
		};
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
		onTick,
		seed,
		toggleMine,
	};
}
