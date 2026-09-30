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
	// Blocks end at the dot's metres only on a road that pins them (#3499).
	const pins = pinned?.stepEndM;
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
				? {
						m,
						fromM: pinned.fromM,
						toM: pinned.toM,
						routeId: pinned.routeId,
						/** The road decides where a block ends (#3499). */
						pinned: !!pins,
						/** The road the dot rides, for the Skyline (#3641). */
						road: pinned.road,
						/** The dot on it: metres from its first, and its speed. */
						along: m - pinned.originM,
						mps: here?.virtualMps ?? 0,
						/** Where the ride starts and each block ends, on it. */
						startM: pinned.fromM - pinned.originM,
						blockEndsM: pins?.map((end) => end - pinned.originM),
					}
				: null;
		},
		/** The workout second the dot puts the rider at; for the ride clock. */
		position:
			pinned && pins
				? (segments: readonly Segment[]) =>
						roadSecond(segments, { fromM: pinned.fromM, stepEndM: pins }, m)
				: undefined,
		/** One ride second at these watts; null off a road. */
		second(watts: number, at: number): RoadSecond | null {
			if (!ride) return null;
			here = ride.second(watts, at);
			return here;
		},
	};
}
