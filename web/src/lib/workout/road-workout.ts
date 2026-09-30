import { zoneOfSegment } from '$lib/components/zones';
import { packRoad, unpackRoad, type Road } from '$lib/road/road';
import type { BandBlock, SkylineView } from '$lib/road/skyline';
import { base64Of } from './import/route';
import type { Segment, Workout } from './types';

/**
 * A road workout (ADR-0062 "A road workout ends a block at a distance",
 * #3499): #3026's compiled route, its steady blocks pinned to the road by
 * `stepEndM`. Solo, a block ends when the dot reaches its metre, never when
 * a clock runs out — the seconds a block carries are the compiler's estimate
 * at the rider's pace, and bias moves the watts, so the metres take longer
 * or shorter while the blocks stay where they are on the road.
 */
export interface PinnedRoad {
	routeId: string;
	/** The road the dot rides, read from where `originM` puts its first metre. */
	road: Road;
	/** Metres along the owner's road. */
	originM: number;
	fromM: number;
	toM: number;
	/** Where each block ends; absent on any workout on a route (#3100). */
	stepEndM?: number[];
}

/**
 * The road a solo ride rides, or null: a workout with no road, or one whose
 * road did not come back with it. A road with pins ends its blocks at their
 * metres; one without (any workout on a route, #3100) by the clock, with the
 * dot riding it all the same (#3594).
 */
export function roadOf(workout: Workout): PinnedRoad | null {
	const ref = workout.road;
	if (!ref?.profile) return null;
	try {
		const bytes = Uint8Array.from(atob(ref.profile), (c) => c.charCodeAt(0));
		return {
			routeId: ref.routeId,
			road: unpackRoad(bytes),
			originM: ref.originM ?? 0,
			fromM: ref.fromM,
			toM: ref.toM,
			...(ref.stepEndM?.length && { stepEndM: ref.stepEndM }),
		};
	} catch {
		return null;
	}
}

/**
 * A workout on one of the rider's own roads, loaded here rather than read
 * back from the shelf (#3594): the road attached as the server attaches it
 * for its owner — the whole road, from its first metre.
 */
export function withProfile(workout: Workout, road: Road): Workout {
	if (!workout.road) return workout;
	return {
		...workout,
		road: {
			...workout.road,
			profile: base64Of(packRoad(road)),
			originM: 0,
		},
	};
}

/**
 * The workout as it goes back up: its road by reference only. The server
 * attaches the reader's cut of the road on read, and refuses one sent back
 * (workout.RoadOf, ADR-0063).
 */
export function byReference(workout: Workout): Workout {
	if (!workout.road) return workout;
	const { routeId, fromM, toM, stepEndM } = workout.road;
	return {
		...workout,
		road: { routeId, fromM, toM, ...(stepEndM && { stepEndM }) },
	};
}

/**
 * The workout second a metre puts the rider at: through each block in step
 * with its metres, so the targets, the graph and the score read the road's
 * blocks with no clock of their own. Past the last pin, the workout's end.
 */
export function roadSecond(
	segments: readonly Segment[],
	road: { fromM: number; stepEndM: number[] },
	m: number,
): number {
	const i = road.stepEndM.findIndex((end) => m < end);
	const last = segments.at(-1);
	if (i < 0 || !segments[i]) return last ? last.startSeconds + last.seconds : 0;
	const start = i === 0 ? road.fromM : road.stepEndM[i - 1];
	const share = Math.min(
		1,
		Math.max(0, (m - start) / (road.stepEndM[i] - start)),
	);
	return segments[i].startSeconds + share * segments[i].seconds;
}

/**
 * A pinned road's blocks by metre, for the Skyline's band (#3641): each from
 * where the last one ended to its own end, in the zone the interval graph
 * gives it. None on a road that does not pin its blocks.
 */
export function bandOf(
	segments: readonly Segment[],
	startM: number,
	endsM: number[] | undefined,
	ftp: number,
): BandBlock[] {
	if (!endsM) return [];
	return endsM.flatMap((toM, i) =>
		segments[i]
			? [
					{
						fromM: i === 0 ? startM : endsM[i - 1],
						toM,
						zone: zoneOfSegment(segments[i], ftp),
					},
				]
			: [],
	);
}

/** A workout ridden on a road, as the Skyline draws it (#3641); null off one. */
export function skylineOf(
	road: {
		road: Road;
		along: number;
		mps: number;
		startM: number;
		blockEndsM?: number[];
	} | null,
	segments: readonly Segment[],
	ftp: number,
): SkylineView | null {
	return road
		? {
				road: road.road,
				m: road.along,
				mps: road.mps,
				band: bandOf(segments, road.startM, road.blockEndsM, ftp),
			}
		: null;
}
