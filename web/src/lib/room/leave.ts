import { goto } from '$app/navigation';
import { page } from '$app/state';
import { roomConnection } from './connection.svelte';

/**
 * Leaving the room you are standing in, from wherever it is offered — the
 * sidebar's row and its menu, the mobile chip (#251), the messages list
 * (#2171). A disconnect, not a leaving: the membership stays and so does the
 * row.
 *
 * The page has to leave too when it is the room's own, or you stare at a room
 * you are no longer in with no way back in (rider report). A surface that is
 * not the room's — the messages list, Home — stays exactly where it is.
 */
export function leaveRoom(): void {
	roomConnection.leave();
	if (page.url.pathname.startsWith('/r/'))
		void goto('/home', { replaceState: true });
}
