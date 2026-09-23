/**
 * The one thing the room says out loud while your screen is live (#563).
 *
 * Screen share is the AV control that can leak something private — an inbox,
 * a calendar, another room's tab — and the browser's own share bar is often
 * on a display the rider cannot see. So the notice is derived, never stored:
 * `sharing` is the single source of truth, and the browser ending the track
 * behind our back (av.svelte.ts, LocalTrackUnpublished) clears the notice
 * with it. Nothing here may remember that a share ever happened.
 */
export interface ShareNotice {
	/** The place the screen is going to, named so it is not "somewhere". */
	name: string;
	/** The way back, when the rider has walked out of that place's pages. */
	href: string | null;
}

export function shareNotice(
	sharing: boolean,
	/** The place the screen goes to: its page, and its name (#2449). */
	place: { home: string; name: string } | null,
	/** Whether the rider is on one of its pages (`onPlacePath`). */
	inside: boolean,
): ShareNotice | null {
	if (!sharing || !place) return null;
	return { name: place.name, href: inside ? null : place.home };
}
