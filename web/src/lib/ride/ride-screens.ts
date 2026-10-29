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
