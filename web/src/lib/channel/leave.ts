import { goto } from '$app/navigation';
import { page } from '$app/state';
import { channelConnection } from './connection.svelte';

/**
 * Leaving the place you are standing in — the you panel's way out (#2447). A
 * disconnect, not a leaving: the membership stays and so does the row.
 *
 * The page has to leave too when it is the place's own, or you stare at a
 * place you are no longer in with no way back in (rider report). It lands on
 * the crew the channel belongs to: you left a channel, not the crew, and Home
 * is "You", somewhere else entirely (#2560). A surface that is not the
 * place's — the messages list, Home — stays exactly where it is. Asked before
 * the leave: after it there is no place to ask about.
 */
export function leaveChannel(): void {
	const place = channelConnection.current?.address;
	const standing = channelConnection.onPlacePath(page.url.pathname);
	channelConnection.leave();
	if (place && standing)
		void goto(`/crew/${place.crew}`, { replaceState: true });
}
