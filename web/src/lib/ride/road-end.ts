/** #3205: at the end of the road, Ride back is what happens after this long. */
export const RIDE_BACK_AFTER_S = 10;

type OnRoad = {
	road: { m: number; atEnd: boolean; lap: number; borrowed?: boolean } | null;
};

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
 * Whether stopping here leaves somewhere to carry on from: partway up the
 * first lap of your own road — a borrowed one saves without it (#3621).
 */
export function carriesOn(road: OnRoad['road']): boolean {
	return !!road && !road.atEnd && road.lap === 0 && !road.borrowed;
}
