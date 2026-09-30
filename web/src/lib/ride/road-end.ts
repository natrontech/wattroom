import { formatKm } from '$lib/format';

/** #3205: at the end of the road, Ride back is what happens after this long. */
export const RIDE_BACK_AFTER_S = 10;

type OnRoad = { road: { m: number; atEnd: boolean; lap: number } | null };

/**
 * Whether the end-of-road sheet is up (#3205): a solo route ride whose dot
 * has reached the end. In a session the coach's plan and its legs decide the
 * end (#3103), and the sheet never appears.
 */
export function roadEndOffered(
	ride: OnRoad & { recording: boolean },
	inSession: boolean,
): boolean {
	return !inSession && ride.recording && !!ride.road?.atEnd;
}

/**
 * End ride's own words: partway up a road's first lap it saves where you are,
 * to carry on from next time (#3205).
 */
export function endRideLabel({ road }: OnRoad): string {
	return road && !road.atEnd && road.lap === 0
		? `Save at km ${formatKm(road.m)}`
		: 'End ride';
}
