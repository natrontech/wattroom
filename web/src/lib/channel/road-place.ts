import type { ServerTick } from '$lib/protocol';
import { turnedRound, type Road } from '$lib/road/road';
import type { PinnedRoad } from '$lib/workout/road-workout';

/** Where a rider is on the session's road. */
export interface RoadPlace {
	/** The road the way the bunch rides it. */
	road: Road;
	/** Metres along it: the bunch's metre and the rider's elastic offset (#3097). */
	m: number;
	/** The bunch's speed, m/s — never the trainer's (ADR-0084). */
	mps: number;
	/** The tick's time, server ms: a place that stops changing is a dropped tick. */
	at: number;
}

/**
 * A rider's place on the session's road (#3663, #3553): what the world draws
 * them at and what their trainer rides. Null off a road: no pick carrying
 * one, or no bunch on the tick.
 */
export function placeOnRoad(
	tick: Pick<ServerTick, 'at' | 'state' | 'world'> | null | undefined,
	cut: PinnedRoad | null,
	you: string,
): RoadPlace | null {
	const route = tick?.state?.route;
	const world = tick?.world;
	if (!cut || !route || !world) return null;
	// The bunch's speed, never the trainer's (ADR-0084: that is the drivetrain's alone).
	const { bunchM, speedMps: bunchMps, offsets } = world;
	return {
		road: route.reverse ? turnedRound(cut.road) : cut.road,
		// Your place is the bunch's and your elastic offset from it, in decimetres.
		m: bunchM + (offsets?.[you] ?? 0) / 10,
		mps: bunchMps,
		at: tick.at,
	};
}

/** docs/SPEC.md "Riding a road together": this long without a tick, and the felt grade relaxes to 0 %. */
export const DEAD_RECKONING_S = 5;

/**
 * A place between ticks (#3553): rolled on at the bunch's speed from when
 * its metre last moved — the bunch steps once a whole second, so a sprint
 * window's 4 Hz ticks repeat the metre — and how long it has been since any
 * tick came at all, by the local clock `now` (ms).
 */
export function createDeadReckoning() {
	let lastM = NaN;
	let movedAt = 0;
	let lastAt = NaN;
	let heardAt = 0;
	return (place: RoadPlace, now: number): { m: number; dead: number } => {
		if (place.m !== lastM) {
			lastM = place.m;
			movedAt = now;
		}
		if (place.at !== lastAt) {
			lastAt = place.at;
			heardAt = now;
		}
		return {
			m: place.m + place.mps * ((now - movedAt) / 1000),
			dead: (now - heardAt) / 1000,
		};
	};
}
