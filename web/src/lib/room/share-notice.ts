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
	/** The room the screen is going to, named so it is not "somewhere". */
	room: string;
	/** The way back, when the rider has walked out of that room's pages. */
	href: string | null;
}

export function shareNotice(
	sharing: boolean,
	room: { slug: string; name?: string } | null,
	pathname: string,
): ShareNotice | null {
	if (!sharing || !room) return null;
	const inside =
		pathname === `/r/${room.slug}` || pathname.startsWith(`/r/${room.slug}/`);
	return {
		room: room.name || room.slug,
		href: inside ? null : `/r/${room.slug}`,
	};
}
