/**
 * The room's announcement (#2408): one line from a coach that outlasts the
 * moment — no session Thursday, the route changed, bring a spare tube.
 *
 * **It is a chat message a coach marked, not a second content system.** The
 * room already has the log, the composer, `room_reads` and the unread counts,
 * and an announcement wants all four and none of them differently; the real
 * one is a boolean on `chat_messages` plus a clause in `PruneChat` so the
 * marked line survives the 500-line cap. That is why there is no announcement
 * composer anywhere in the app: a coach types a sentence into the box the room
 * already has, then marks it.
 *
 * One at a time, deliberately. A list of standing notices is a page, and a
 * page is pull — the thing an announcement must not be (#2405 kept the page,
 * this took the strip). Marking a new one replaces the old, which is also how
 * a coach retracts a wrong one without a second control.
 */
export interface Announcement {
	/** The marked message's text, verbatim. */
	text: string;
	/** Who wrote it — the message's author, not whoever marked it. */
	from: string;
	/** ISO, the message's own timestamp. */
	at: string;
}

/**
 * ponytail: the mock's stand-in for the marked message. The real one arrives
 * on the room payload and changes over the socket; only this file changes.
 */
export const announcement = $state<{ current: Announcement | null }>({
	current: {
		text: "No session Thursday — I'm away. Back the week after, same time.",
		from: 'Nina',
		at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
	},
});

export function announce(text: string, from: string, at: string): void {
	announcement.current = { text, from, at };
}

export function clearAnnouncement(): void {
	announcement.current = null;
}
