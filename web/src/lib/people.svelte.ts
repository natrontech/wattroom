/**
 * Faces by id (#807). A chat line carries `fromId` and a display name, never
 * a face — so the same rider was a coloured initial in the log and a real
 * avatar with a level ring in the column right beside it.
 *
 * Nothing fetches for this. Everything that already loads people — the crew's
 * people, the DM heads, the friends list, you — drops what it learned here,
 * and whoever needs a face asks. An id nobody has taught falls back to the
 * initial exactly as before, so no surface waits on it.
 */
import type { StatusLine } from '$lib/protocol';

export interface Face {
	id: string;
	/** Their display name — the initial a face without a picture falls back to. */
	name?: string;
	avatarUrl?: string;
	totalXp?: number;
	/**
	 * Their status line (ADR-0060). `null` is "none"; `undefined` is "this
	 * feed does not carry one" — the DM heads, a chat line — and keeps what a
	 * feed that does carry it taught, rather than wiping it.
	 */
	statusLine?: StatusLine | null;
}

const sameLine = (a?: StatusLine | null, b?: StatusLine | null) =>
	a === b ||
	(!!a &&
		!!b &&
		a.emoji === b.emoji &&
		a.emojiId === b.emojiId &&
		a.text === b.text &&
		a.expiresAt === b.expiresAt);

const faces = $state<Record<string, Face>>({});

export const people = {
	/**
	 * Remember these. Writes only what changed: the feeds are polls, and
	 * re-assigning an identical face every 10 s would redraw every avatar in
	 * an open chat for nothing.
	 */
	learn(list: readonly (Face | undefined | null)[]): void {
		for (const person of list) {
			if (!person?.id) continue;
			const known = faces[person.id];
			const statusLine =
				person.statusLine === undefined
					? known?.statusLine
					: person.statusLine;
			if (
				known &&
				known.name === person.name &&
				known.avatarUrl === person.avatarUrl &&
				known.totalXp === person.totalXp &&
				sameLine(known.statusLine, statusLine)
			)
				continue;
			faces[person.id] = {
				id: person.id,
				name: person.name,
				avatarUrl: person.avatarUrl,
				totalXp: person.totalXp,
				statusLine,
			};
		}
	},
	face(id: string | undefined | null): Face | undefined {
		return id ? faces[id] : undefined;
	},
};
