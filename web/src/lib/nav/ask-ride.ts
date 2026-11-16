import { goto } from '$app/navigation';
import { page } from '$app/state';
import { channelConnection } from '#lib/channel/connection.svelte.ts';
import { device } from '#lib/device.svelte.ts';
import { nowPanel } from './now-panel.svelte.ts';

/**
 * The one way into a ride from a voice channel (#4616). In a call, a door
 * asks the channel's shell for the ride sheet, pre-filled, and goes to the
 * channel's page if it is elsewhere. Out of one there is nothing to ask:
 * false, and the door does what it always did. A phone rides nothing.
 */
export function askRide(ask: { who?: 'join'; pick?: string } = {}): boolean {
	const conn = channelConnection.call;
	if (!conn || device.spectator) return false;
	nowPanel.who = ask.who ?? null;
	nowPanel.pick = ask.pick ?? null;
	nowPanel.ask = 'ride';
	if (!channelConnection.onPlacePath(page.url.pathname))
		void goto(conn.address.home);
	return true;
}

/** A link's click that the ride sheet takes over while you are in a call. */
export function rideClick(
	event: MouseEvent,
	ask: { who?: 'join'; pick?: string } = {},
): void {
	if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
		return;
	if (askRide(ask)) event.preventDefault();
}
