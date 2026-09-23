/**
 * The calendar link, in the two places that offer one (ADR-0021): your own
 * feed in Settings and a crew's on its Schedule (#2452). Both copy it and
 * both can reset it, and they had a verbatim copy each of the clipboard
 * handler and of every string — so a fix to one silently left the other
 * saying something else.
 *
 * The reset asks first. It cannot be undone and the cost is not the rider's:
 * every calendar already subscribed to the old link goes quiet, and finds out
 * by quietly not updating. That is errors.md's third case — no undo to offer,
 * and the cost paid outside the click — and an *Advanced* expander is where
 * the control is, never what it breaks (#1493).
 */
import { confirm } from '$lib/confirm.svelte';
import { copyText, theLinkItself } from '$lib/copy';

/** Whose calendar: the rider's own feed, or a crew's schedule (#2452). */
export type CalendarScope = 'yours' | 'crew';

const whoseLink: Record<CalendarScope, string> = {
	yours: 'your',
	crew: "this crew's",
};

/** What a reset breaks, and the way back — said before the button. */
export function resetBody(scope: CalendarScope): string {
	return `Every calendar subscribed to ${whoseLink[scope]} old link stops updating — including anyone you shared it with, who is not told. Each one has to subscribe again with the new link. The old link cannot be brought back.`;
}

/** The ask. Resolves to whether the rider wants the link reset. */
export function confirmCalendarReset(scope: CalendarScope): Promise<boolean> {
	return confirm({
		title: `Reset ${whoseLink[scope]} calendar link?`,
		body: resetBody(scope),
		action: 'Reset the link',
		cancel: 'Keep it',
	});
}

/** Said once it is done, in both places. */
export const RESET_DONE =
	'Calendar link reset — calendars on the old link stop updating.';

/** The link onto the clipboard, with the fallback a denied clipboard needs
 *  (#1764): the link itself is the feedback, not a dead "copied". */
export async function copyCalendarLink(link: string): Promise<void> {
	await copyText(
		link,
		'Calendar link copied — subscribe "from URL" in your calendar app.',
		theLinkItself(link),
	);
}
