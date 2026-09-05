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
}
