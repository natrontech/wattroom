/**
 * The screens that draw the ride alone (ADR-0093): /ride, and a voice
 * channel's Training page. Anywhere else the ride runs on unseen, and the
 * frame is a desk frame.
 */
export function drawsTheRide(pathname: string): boolean {
	return (
		pathname === '/ride' || /^\/crew\/[^/]+\/v\/[^/]+\/training$/.test(pathname)
	);
}

/**
 * The ride dock shows (ADR-0093 point 5): a ride runs and no riding screen
 * draws it. With no ride, or on its screen, the sidebar has none.
 */
export function dockShows(live: boolean, pathname: string): boolean {
	return live && !drawsTheRide(pathname);
}
