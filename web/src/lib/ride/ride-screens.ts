/**
 * The screens that draw the ride alone (ADR-0093): /ride, /ramp, and a
 * voice channel's Training page. Anywhere else the ride runs on unseen, and
 * the frame is a desk frame.
 */
export function drawsTheRide(pathname: string): boolean {
	return (
		pathname === '/ride' ||
		pathname === '/ramp' ||
		/^\/crew\/[^/]+\/v\/[^/]+\/training$/.test(pathname)
	);
}

/**
 * The ride dock shows (ADR-0093 point 5): a ride runs and no riding screen
 * draws it. With no ride, or on its screen, the sidebar has none.
 */
export function dockShows(live: boolean, pathname: string): boolean {
	return live && !drawsTheRide(pathname);
}

/**
 * Where the dock's Open and End ride go: the riding screen the rider last
 * had open, /ride or /ramp, and a voice channel's Training page only while
 * they are still in its call (`training`, the call's own). Opening it joins
 * that channel, which would hang up the one they are in now.
 */
export function dockScreen(last: string, training: string | undefined): string {
	return last === '/ramp' || last === training ? last : '/ride';
}
