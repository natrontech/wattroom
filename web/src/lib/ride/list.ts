import type { RideRecord } from '$lib/history.svelte';
import { FREE_RIDE_NAME } from '$lib/ride/free-ride.svelte';

/** The one line a place with no ride yet teaches (ux.md): Home and History say the same thing. */
export const NO_RIDES_YET = 'No rides yet — every ride you finish lands here.';

/** Where a ride was ridden (#2443): a crew, and the voice channel in it. */
export interface RidePlace {
	id: string;
	name: string;
}

/**
 * How a ride says where it was ridden (#2457): "with Thursday Crew in Pain
 * Cave", the crew alone for a ride whose channel is gone, "in a session" for
 * one whose crew is gone (#2630), and "solo" for a ride that was not in a
 * session at all. One sentence for the list and the ride page, so a ride
 * never reads as two places on two screens.
 */
export function ridePlace(ride: {
	crew?: RidePlace | null;
	channel?: RidePlace | null;
	/** Ridden in a session, whatever became of its crew. */
	inSession?: boolean;
}): string {
	if (!ride.crew) return ride.inSession ? 'in a session' : 'solo';
	return ride.channel
		? `with ${ride.crew.name} in ${ride.channel.name}`
		: `with ${ride.crew.name}`;
}

/**
 * A road of the rider's own that a ride rode (#3874): the name they know it
 * by, and the generated one a session on it was saved under. Only on the
 * owner's read of their own ride (ADR-0063).
 */
export interface RideRoad {
	routeId: string;
	name: string;
	genName: string;
}

/**
 * The road a ride is named by (#3874, Flows rule 2): on a road of the rider's
 * own, a ride saved under no name of its own — a free ride, or a session that
 * rode the road under its generated name — is the road, named as its route
 * page names it. A workout keeps its own name, and answers none.
 */
export function namingRoad(ride: {
	workoutName: string;
	road?: RideRoad;
}): RideRoad | undefined {
	const { workoutName, road } = ride;
	if (!road) return undefined;
	if (workoutName === FREE_RIDE_NAME) return road;
	if (road.genName && workoutName.startsWith(road.genName)) return road;
	return undefined;
}

/**
 * What a ride is called: its road's name when the road names it (a long
 * road's legs keep their "· leg 1 of 2"), else its workout's. One title for
 * the list, Home and the ride page, so a ride never reads as two rides.
 */
export function rideTitle(ride: {
	workoutName: string;
	road?: RideRoad;
}): string {
	const road = namingRoad(ride);
	if (!road) return ride.workoutName;
	return road.genName && ride.workoutName.startsWith(road.genName)
		? road.name + ride.workoutName.slice(road.genName.length)
		: road.name;
}

export interface ServerRide extends RideRecord {
	xp: number;
	inSession?: boolean;
	crew?: RidePlace;
	channel?: RidePlace;
	/** The per-ride opt-in (ADR-0024): friends see it on your page. */
	sharedWithFriends: boolean;
	/** The Strava delivery, when the ride had one (#1553). */
	exportState?: 'pending' | 'delivered' | 'failed';
	/** A road ride's metres and climbing, the server's replay (#3053). */
	distanceM?: number;
	climbedM?: number;
	/** The rider's own road it rode (#3874). */
	road?: RideRoad;
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
