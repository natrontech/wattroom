import { BikeKg } from '$lib/protocol';
import type { RideableRoute } from '$lib/ride/roads';
import type { Workout } from '$lib/workout/types';
import { withProfile } from '$lib/workout/road-workout';
import { climbsOf } from './climbs';
import { compileRoad } from './compile';

/**
 * The road's own workout for this rider (#3601): compiled at their FTP and
 * weight when the ride starts, never stored, so the legs match today's FTP.
 * Each leg carries the road, ready to ride.
 */
export function legsOf(
	route: RideableRoute,
	ftp: number,
	riderKg: number,
): Workout[] {
	return compileRoad(
		{
			id: route.id,
			genName: route.generatedName ?? route.name,
			road: route.road,
			climbs: climbsOf(route.road),
		},
		ftp,
		riderKg + BikeKg,
	).map((leg) => withProfile(leg, route.road));
}

/** The offer at leg k's summary (1-based), or null when the route ends with it. */
export function nextLeg(
	routeId: string,
	k: number,
	n: number,
): { label: string; href: string } | null {
	return k < n
		? {
				label: `Ride leg ${k + 1} of ${n}`,
				href: `/ride?road=${encodeURIComponent(routeId)}&leg=${k + 1}`,
			}
		: null;
}
