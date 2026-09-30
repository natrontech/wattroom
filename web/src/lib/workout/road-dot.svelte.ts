import { createRoadRide, type RoadSecond } from '$lib/ride/road-ride';
import { roadOf, roadSecond } from './road-workout';
import type { Segment, Workout } from './types';

/**
 * The dot of a solo road workout (#3499): #3027's road ride under the
 * engine, moved a ride second at a time by the watts the rider makes. Absent
 * off a pinned road, and nothing about the ride changes then.
 */
export function createRoadDot(workout: Workout, kg: () => number) {
	const pinned = roadOf(workout);
	const ride = pinned
		? createRoadRide(pinned.road, { kg, from: pinned.fromM - pinned.originM })
		: null;
	let here = $state.raw<RoadSecond | null>(null);
	/** Metres along the owner's road, where the pins are. */
	const m = $derived(
		pinned ? pinned.originM + (here?.m ?? pinned.fromM - pinned.originM) : 0,
	);
	return {
		pinned,
		get m() {
			return m;
		},
		get here() {
			return here;
		},
		/** Where the dot is and where the ride ends, on the owner's road. */
		get summary() {
			return pinned
				? { m, fromM: pinned.fromM, toM: pinned.toM, routeId: pinned.routeId }
				: null;
		},
		/** The workout second the dot puts the rider at; for the ride clock. */
		position: pinned
			? (segments: readonly Segment[]) => roadSecond(segments, pinned, m)
			: undefined,
		/** One ride second at these watts; null off a road. */
		second(watts: number, at: number): RoadSecond | null {
			if (!ride) return null;
			here = ride.second(watts, at);
			return here;
		},
	};
}
