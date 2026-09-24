/**
 * A thread's lines as MessageThread renders them (#321), whether a text
 * channel or a DM fed them in.
 */

/** What the panel needs of a chat line; the store passes protocol ChatLines. */
export type TimelineMessage = {
	id?: string;
	from: string;
	/** Whose line this is, for own-message and "N new" exclusion (#672). */
	fromId?: string;
	text: string;
	imageId?: string;
	at: number;
	/** When the author last rewrote it (#865); absent for a line as sent. */
	editedAt?: number;
	/**
	 * When the sender took it back (#2418) — a DM only. A channel's line is
	 * gone from the log entirely (#2417), so nothing there ever sets this;
	 * a DM leaves the row so the other side can be told at all.
	 */
	deletedAt?: number;
	/**
	 * When a temporary line runs out (#2644). The thread drops it then by its
	 * own clock; the server has stopped serving it and sweeps it within the
	 * minute, but a DM's poll never says "gone".
	 */
	expiresAt?: number;
};

export type TimelineEntry = {
	key: string;
	at: number;
	message: TimelineMessage;
};

/** The lines oldest first, each keyed by its id — or, before it has one, by when and who. */
export function messageTimeline(messages: TimelineMessage[]): TimelineEntry[] {
	return messages
		.map((message) => ({
			key: message.id ?? `m:${message.at}:${message.from}`,
			at: message.at,
			message,
		}))
		.sort((a, b) => a.at - b.at);
}

/**
 * How many lines from someone else landed after a reader scrolled back
 * (#2703), `seen` being the keys the log held when they left. Counted from
 * the lines, not the DOM: an edit, a reaction, a card loading or a countdown
 * ticking is no message, and three lines in one poll are three.
 */
export function arrivedSince(
	timeline: TimelineEntry[],
	seen: ReadonlySet<string>,
	me: string | undefined,
): number {
	return timeline.filter(
		(entry) => !seen.has(entry.key) && entry.message.fromId !== me,
	).length;
}
