export type RoomNavState = 'connected' | 'browsing' | 'idle';

/**
 * Describes how the sidebar should visually treat a room. Connection wins over
 * browsing so the room the rider is standing in always has the strongest mark.
 */
export function roomNavState(
	slug: string,
	activeSlug: string,
	connectedSlug: string,
	reading: boolean,
): RoomNavState {
	if (slug === connectedSlug) return 'connected';
	if (slug === activeSlug || reading) return 'browsing';
	return 'idle';
}
