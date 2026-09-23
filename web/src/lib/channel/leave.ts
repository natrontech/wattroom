import { goto } from '$app/navigation';
import { page } from '$app/state';
import { roomConnection } from './connection.svelte';

/**
 * Leaving the place you are standing in — the you panel's way out (#2447). A
 * disconnect, not a leaving: the membership stays and so does the row.
 *
 * The page has to leave too when it is the place's own, or you stare at a
 * place you are no longer in with no way back in (rider report). A surface
 * that is not the place's — the messages list, Home — stays exactly where it
 * is. Asked before the leave: after it there is no place to ask about.
 */
export function leaveRoom(): void {
	const standing = roomConnection.onPlacePath(page.url.pathname);
	roomConnection.leave();
	if (standing) void goto('/home', { replaceState: true });
}
