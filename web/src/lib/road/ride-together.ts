import {
	BikeKg,
	ReferenceRiderKg,
	ReferenceRiderWatts,
	RouteHiddenEndM,
	type ControlRoute,
} from '$lib/protocol';
import type { Workout } from '$lib/workout/types';
import type { Climb } from './climbs';
import { compileRoad, type Stretch } from './compile';
import { roadStep, type Road } from './road';

/**
 * "Ride it together" (#3105, ADR-0065): a road picked into a session. The
 * crew rides the road's own workout — ERG by the road — timed at the
 * reference rider, whom the bunch's prescribed pace follows, so the shared
 * clock and the bunch agree. A road longer than a sitting rides its first leg.
 */
export function rideTogether(
	route: { id: string; genName: string; road: Road; climbs: Climb[] },
	ridden: Stretch,
): { workout: Workout; route: ControlRoute; legs: number } {
	const legs = compileRoad(
		route,
		ReferenceRiderWatts,
		ReferenceRiderKg + BikeKg,
		ridden,
	);
	return {
		workout: legs[0],
		legs: legs.length,
		route: { id: route.id, fromM: crewFromM(route.road, ridden.fromM) },
	};
}

/**
 * An owner's metre on the crew's cut (#3095): every socket in a session rides
 * the span between the anchors, starting at the first sample past the hidden
 * end, exactly as the server's Cut takes it — so a start inside a hidden end
 * starts where the crew's road does.
 */
export function crewFromM(road: Road, fromM: number): number {
	const step = roadStep(road);
	const first = Math.ceil(RouteHiddenEndM / step);
	const last = Math.min(
		Math.floor((road.length - RouteHiddenEndM) / step),
		road.heights.length - 1,
	);
	return Math.min(Math.max(fromM - first * step, 0), (last - first - 1) * step);
}
