import { createRoadReadout } from '$lib/ride/road-readout';
import {
	createRoadLaps,
	type RoadSampleFields,
	type RoadSecond,
} from '$lib/ride/road-ride';
import { roadOf, roadSecond } from './road-workout';
import type { Segment, Workout } from './types';

/**
 * The dot of a solo road workout (#3499): #3205's laps under the engine,
 * moved a ride second at a time by the watts the rider makes. Absent off a
 * pinned road, and nothing about the ride changes then.
 *
 * A workout whose clock ends its blocks outlasts its road (#4261): on a loop
 * the next lap starts at the line, and an open road turns at its end, as a
 * free ride's does unasked. A road that pins its blocks ends the workout at
 * its last pin, so its dot never laps.
 */
export function createRoadDot(workout: Workout, kg: () => number) {
	const pinned = roadOf(workout);
	// Blocks end at the dot's metres only on a road that pins them (#3499).
	const pins = pinned?.stepEndM;
	const ride = pinned
		? createRoadLaps(pinned.road, {
				kg,
				from: pinned.fromM - pinned.originM,
				loop: pinned.loop && !pins,
			})
		: null;
	let start = $state(pinned?.fromM ?? 0);
	let entered: Segment | undefined;
	let here = $state.raw<RoadSecond | null>(null);
	let reverse = $state(false);
	/** Metres along the owner's road, where the pins are. */
	const m = $derived(pinned ? (here ? pinned.originM + here.m : start) : 0);
	// One readout a second, for slot 1 and the HUD alike (#3639).
	const readoutAt = createRoadReadout();
	const readout = $derived(
		pinned ? readoutAt(pinned.road, m - pinned.originM, reverse) : null,
	);
	return {
		pinned,
		/** Enter a new block once, including each expanded repeat. */
		enter(segment: Segment) {
			if (entered === segment) return;
			entered = segment;
			if (
				!pinned ||
				!ride ||
				segment.kind !== 'road' ||
				segment.fromM === undefined
			)
				return;
			// A new lap from the block's metre: the server takes the jump (#3598).
			ride.jump(segment.fromM - pinned.originM, false);
			reverse = false;
			start = pinned.originM + ride.from;
			here = null;
		},
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
						/** The road has no end: the world laps it (#4261). */
						loop: pinned.loop,
						/** The dot on it: metres from its first, and its speed. */
						along: m - pinned.originM,
						mps: here?.virtualMps ?? 0,
						/** This lap runs back down the road: `along` counts down (#4261). */
						reverse,
						/** Where the ride starts and each block ends, on it. */
						startM: pinned.fromM - pinned.originM,
						blockEndsM: pins?.map((end) => end - pinned.originM),
						/** Where it is, as slot 1 and the HUD say it (#3639). */
						readout: readout!,
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
			if (here.atEnd && !pins) {
				ride.turn('back');
				// The lap's first sample stands where it starts (#3117).
				here = ride.start();
			}
			reverse = ride.reverse;
			return here;
		},
		/** This second's place as the record keeps it, on the owner's road (#3598). */
		fields(): RoadSampleFields | null {
			if (!pinned || !ride || !here) return null;
			const out = ride.fields(here);
			return { ...out, m: pinned.originM + out.m };
		},
	};
}
