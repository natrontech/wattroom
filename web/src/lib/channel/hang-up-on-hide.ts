import { channelConnection } from './connection.svelte';

/**
 * The desktop window was closed (#3005). A close hides it rather than
 * destroying it, so the page runs on behind it — notifications, the lobby
 * socket — but a closed window is never a live mic: voice and every capture
 * go, and with them lounge-presence XP. A ride keeps riding, and the channel's
 * socket stays, so the HUD and the ride carry on as they do behind another app.
 */
export function hangUpOnHide(visible: boolean): void {
	const av = channelConnection.current?.av;
	if (!visible && av && av.status !== 'off') av.leave();
}
