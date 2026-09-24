import type { TimelineEntry, TimelineMessage } from '$lib/messages/timeline';

/**
 * What MessageThread.svelte needs of one line, whatever it came from — a
 * text channel's socket or a DM's poll; `messageTimeline()` orders both.
 */
export type ThreadMessage = TimelineMessage;

/**
 * The reactive surface MessageThread.svelte renders. Reactions are
 * capability-gated (ux.md): omit `reactions`/`onReact` and the affordance
 * simply does not render, rather than failing on click — a DM has no
 * reaction backend yet (#672 follow-up).
 */
export interface ThreadSource {
	timeline: TimelineEntry[];
	loading: boolean;
	error: string | null;
	/** Frozen when the thread opens — where the "N new" divider sits. */
	readAt: number | null;
	reactions?: Record<string, Record<string, number>>;
	myReacts?: Record<string, boolean>;
	/** The crew's reaction set, first in the picker (#2643). */
	cheers?: string[];
	/** The crew whose uploaded emoji the picker offers; none in a DM. */
	crewId?: string;
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
	 * The crew's ban for a line's author, from the line itself (#1765, #2530):
	 * chat is where you meet the griefer. Per PERSON, like canRemove is per
	 * message — undefined where the reader may not ban them. A DM passes none,
	 * and the menu then offers no such item.
	 */
	banOf?: (id: string, name: string) => (() => void) | undefined;
	/**
	 * Take a line out of the log for good (#2417). Capability-gated like the
	 * rest, and per MESSAGE rather than per thread: the author's own always,
	 * anyone's for the crew's owner and admins, nobody else's. A surface that
	 * omits it offers no Delete rather than one that is refused.
	 *
	 * Resolves to the refusal, or null once the line is gone.
	 */
	remove?: (id: string) => Promise<string | null>;
	/** Whether `remove` would be allowed for this line — the menu asks first. */
	canRemove?: (message: { id?: string; fromId?: string }) => boolean;
	/**
	 * Mark a line as the text channel's announcement (#2408, ADR-0058), when
	 * the viewer is the crew's owner or an admin. Capability-gated like the
	 * rest: a DM, and every other rider, get no such item.
	 *
	 * This is the whole reason an announcement has no composer of its own —
	 * an admin types the sentence into the box the channel already has, and
	 * marks it from here.
	 */
	announce?: (messageId: string) => void;
}
