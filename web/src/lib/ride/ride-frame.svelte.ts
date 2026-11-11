import { page } from '$app/state';
import { channelConnection } from '#lib/channel/connection.svelte.ts';
import { theRide } from '#lib/ride/the-ride.svelte.ts';
import { drawsTheRide } from '#lib/ride/ride-screens.ts';
import { soloRide } from '#lib/workout/ride-life.svelte.ts';

/**
 * The one answer to "is the frame the ride" (#4472): the root layout's
 * `data-ride`, the now bar, the desktop HUD and the lounge drawn inside the
 * riding screen all read it, so they never disagree. The ride alone is the
 * frame where one of its screens draws it; a ride in a place, on that
 * place's own pages. Everywhere else a ride runs on in the dock.
 */
export const rideFrame = {
	/** The ride alone, on a screen that draws it. */
	get alone(): boolean {
		return theRide.alone ? drawsTheRide(page.url.pathname) : soloRide.active;
	},
	/** The frame is the ride: alone, or on the place the ride rides on. */
	get riding(): boolean {
		return (
			(channelConnection.onPlacePath(page.url.pathname) &&
				!!channelConnection.current?.riding()) ||
			this.alone
		);
	},
};
