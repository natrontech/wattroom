import { BikeKg } from '#lib/protocol.ts';
import { durationSeconds } from '#lib/workout/engine.ts';
import type { Climb } from './climbs';
import { compileRoad } from './compile';
import type { Road } from './road';

/**
 * The Routes view's filter chips (#3692, docs/spec/roads.md): each chip is an
 * "at most", and a group with none lit is no bound.
 */
export const ROUTE_BOUNDS = {
	km: [20, 50, 100],
	up: [250, 500, 1000],
	hours: [1, 2, 3],
} as const;

export type RouteBounds = {
	km: number | null;
	up: number | null;
	hours: number | null;
};

/**
 * Whether a route fits the bounds. A time not known yet (its road still being
 * read) keeps the route, as the session picker does.
 */
export function fitsBounds(
	route: { lengthM: number; gainM: number },
	seconds: number | null,
	b: RouteBounds,
): boolean {
	return (
		(b.km === null || route.lengthM <= b.km * 1000) &&
		(b.up === null || route.gainM <= b.up) &&
		(b.hours === null || seconds === null || seconds <= b.hours * 3600)
	);
}

/**
 * "At your pace": the road ridden as its road workout — ERG by the road — at
 * the rider's own FTP and weight, every leg of it.
 */
export function secondsAtPace(
	route: { id: string; genName: string; road: Road; climbs: Climb[] },
	ftp: number,
	riderKg: number,
): number {
	return compileRoad(route, ftp, riderKg + BikeKg).reduce(
		(total, leg) => total + durationSeconds(leg),
		0,
	);
}
