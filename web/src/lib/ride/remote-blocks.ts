import type { PauseState } from '$lib/protocol';
import { isOpenRoad } from '$lib/workout/ridden';
import type { Workout } from '$lib/workout/types';

/** As much of a workout session as Pause, Skip and +1 min read. */
export type ClockedRide = {
	state: string;
	held: boolean;
	workout: Workout;
	segments: readonly unknown[];
	info: { segmentIndex: number };
	road: { pinned?: boolean } | null;
	pause(): void;
	resume(): void;
	skip(): void;
	extend(seconds: number): void;
};

/** Why Skip waits on the last block, on the riding screen and the phone. */
export const LAST_BLOCK = 'Last block — End ride instead';

/** Why the phone holds Skip and +1 min on a ride whose clock ends no block. */
export const NO_BLOCKS = 'Skip and +1 min need a workout timed by the clock.';

/** +1 min, as the riding screen's own button (RideControls). */
export const EXTEND_SECONDS = 60;

/**
 * The riding screen's answer about its workout for the phone (#3217, #4425),
 * the rule RideControls draws: it pauses once the count-in is over; Skip
 * block and +1 min act only where the clock ends the blocks, so never on a
 * road workout whose blocks end at their metres (#3499) nor on a road with
 * no workout; on the last block Skip is End ride's.
 */
export function pauseOf(ride: ClockedRide | null | undefined): PauseState {
	const pausable =
		!!ride &&
		ride.state !== 'idle' &&
		ride.state !== 'countdown' &&
		ride.state !== 'done';
	if (!ride || !pausable) return { pausable: false, paused: !!ride?.held };
	const blocks = !ride.road?.pinned && !isOpenRoad(ride.workout);
	return {
		pausable,
		paused: ride.held,
		...(blocks && { blocks }),
		...(blocks &&
			ride.info.segmentIndex + 1 >= ride.segments.length && { last: true }),
	};
}

/**
 * The phone's Pause, Resume, Skip and +1 min on a workout, each only where
 * the riding screen offers it, so a press that crossed a change does nothing.
 */
export function clockActions(ride: () => ClockedRide | null | undefined) {
	const when =
		(ok: (p: PauseState) => boolean, act: (r: ClockedRide) => void) => () => {
			const r = ride();
			if (r && ok(pauseOf(r))) act(r);
		};
	return {
		pause: when(
			(p) => p.pausable,
			(r) => r.pause(),
		),
		resume: when(
			(p) => p.pausable,
			(r) => r.resume(),
		),
		skip: when(
			(p) => !!p.blocks && !p.last,
			(r) => r.skip(),
		),
		extend: when(
			(p) => !!p.blocks,
			(r) => r.extend(EXTEND_SECONDS),
		),
	};
}
