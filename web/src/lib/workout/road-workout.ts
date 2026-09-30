import { unpackRoad, type Road } from '$lib/road/road';
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
	stepEndM: number[];
}

/**
 * The pinned road a solo ride rides, or null: a workout with no road, a road
 * with no pins (any workout on a route, #3100, whose blocks end by the clock),
 * or one whose road did not come back with it.
 */
export function roadOf(workout: Workout): PinnedRoad | null {
	const ref = workout.road;
	if (!ref?.stepEndM?.length || !ref.profile) return null;
	try {
		const bytes = Uint8Array.from(atob(ref.profile), (c) => c.charCodeAt(0));
		return {
			routeId: ref.routeId,
			road: unpackRoad(bytes),
			originM: ref.originM ?? 0,
			fromM: ref.fromM,
			toM: ref.toM,
			stepEndM: ref.stepEndM,
		};
	} catch {
		return null;
	}
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
	road: Pick<PinnedRoad, 'fromM' | 'stepEndM'>,
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
