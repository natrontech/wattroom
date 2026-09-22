import type { RideRecord } from '$lib/history.svelte';

/** Where a ride was ridden (#2443): a crew, and the voice channel in it. */
export interface RidePlace {
	id: string;
	name: string;
}

/**
 * How a ride says where it was ridden (#2457): "with Thursday Crew in Pain
 * Cave", the crew alone for a ride whose channel is gone, and "solo" for a
 * ride that was not in a session at all. One sentence for the list and the
 * ride page, so a ride never reads as two places on two screens.
 */
export function ridePlace(ride: {
	crew?: RidePlace | null;
	channel?: RidePlace | null;
}): string {
	if (!ride.crew) return 'solo';
	return ride.channel
		? `with ${ride.crew.name} in ${ride.channel.name}`
		: `with ${ride.crew.name}`;
}

export interface ServerRide extends RideRecord {
	xp: number;
	room?: boolean;
	crew?: RidePlace;
	channel?: RidePlace;
	/** The per-ride opt-in (ADR-0024): friends see it on your page. */
	sharedWithFriends: boolean;
	/** The Strava delivery, when the ride had one (#1553). */
	exportState?: 'pending' | 'delivered' | 'failed';
}

/** One page of the rides list (#1549). */
export interface RidesPage {
	rides: ServerRide[];
	more?: boolean;
	nextBefore?: string;
	nextBeforeId?: string;
}

/**
 * The server's page cursor (#2064): a start and the ride id that breaks its
 * tie. Taken from the page verbatim — a cursor derived from the oldest row's
 * own `startedAt` is a second where the start is microseconds, and paging
 * from it stepped over every ride inside that second.
 */
export type RideCursor = { before: string; beforeId: string };

export const rideCursorOf = (page: RidesPage): RideCursor | null =>
	page.nextBefore && page.nextBeforeId
		? { before: page.nextBefore, beforeId: page.nextBeforeId }
		: null;

/** The query string that asks for the page after `cursor`. */
export const rideCursorQuery = (cursor: RideCursor): string =>
	`before=${encodeURIComponent(cursor.before)}&beforeId=${encodeURIComponent(cursor.beforeId)}`;
