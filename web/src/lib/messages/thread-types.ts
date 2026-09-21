import type { TimelineEntry, TimelineMessage } from '$lib/room/timeline';

/**
 * What MessageThread.svelte needs of one line, whatever it came from — a
 * live room socket, the room's backlog read from outside, or a DM's poll.
 * Same shape `roomTimeline()` already merges room events onto; a DM just
 * feeds it an empty event list.
 */
export type ThreadMessage = TimelineMessage;

/**
 * The reactive surface MessageThread.svelte renders. Reactions and the link-
 * queue menu item are capability-gated (ux.md): omit `reactions`/`onReact`
 * or `onQueue` and that affordance simply does not render, rather than
 * failing on click — a DM has no reaction backend yet (#672 follow-up).
 */
export interface ThreadSource {
	timeline: TimelineEntry[];
	loading: boolean;
	error: string | null;
	/** Frozen when the thread opens — where the "N new" divider sits. */
	readAt: number | null;
	reactions?: Record<string, Record<string, number>>;
	myReacts?: Record<string, boolean>;
	cheers?: string[];
	retry: () => void;
	send: (text: string, image?: Blob) => Promise<string | null>;
	react?: (id: string, cheer: string) => Promise<string | null>;
	/**
	 * Rewrite a line this rider sent (#865). Capability-gated like `react`:
	 * a surface that omits it simply offers no Edit, rather than offering one
	 * that fails. Resolves to the refusal, or null once the line has changed.
	 */
	edit?: (id: string, text: string) => Promise<string | null>;
	/**
	 * The owner's ban, when the viewer is the owner and the thread is a
	 * room's (#1765, #666): chat is where you meet the griefer. Absent on a
	 * DM and for everyone else — the menu then offers no such item.
	 */
	ban?: (id: string, name: string) => void;
	/**
	 * Take a line out of the log for good (#2417). Capability-gated like the
	 * rest, and per MESSAGE rather than per thread: the author's own always,
	 * anyone's for a room's owner, nobody else's. A surface that omits it
	 * offers no Delete rather than one that is refused.
	 *
	 * Resolves to the refusal, or null once the line is gone.
	 */
	remove?: (id: string) => Promise<string | null>;
	/** Whether `remove` would be allowed for this line — the menu asks first. */
	canRemove?: (message: { id?: string; fromId?: string }) => boolean;
	/**
	 * Mark a line as the room's announcement (#2408), when the viewer is a
	 * coach or the owner and the thread is a room's. Capability-gated like
	 * the rest: a DM, and every other rider, get no such item.
	 *
	 * This is the whole reason an announcement has no composer of its own —
	 * a coach types the sentence into the box the room already has, and marks
	 * it from here.
	 */
	announce?: (messageId: string) => void;
}
