import { flatten, segmentsDuration, targetAt } from './engine';
import { createSprintWindow } from './sprint-window.svelte';
import { stretchSegments, stretchWorkout } from './stretch';
import type { Segment, Workout } from './types';

/**
 * Where on its workout a solo ride is: the clock, what the workout asks
 * there, and the sprint window the screen draws. Skip moves the clock (#13);
 * +1 min lengthens the block under way (#4445), so the workout this clock
 * runs on is the one as ridden: its segments, its length and what the ride
 * saves all read the blocks with the minutes added.
 */
export function createRideClock(
	workout: Workout,
	ftp: number,
	ride: {
		bias: () => number;
		over: () => boolean;
		/**
		 * A road workout's position (#3499): the workout second the dot's
		 * metre puts the rider at, which replaces the clock's own.
		 */
		road?: (segments: readonly Segment[]) => number;
	},
) {
	const written = flatten(workout);
	/** Seconds +1 min added to each block, indexed as the segments. */
	let extra = $state.raw<number[]>(written.map(() => 0));
	const segments = $derived(stretchSegments(written, extra));
	const total = $derived(segmentsDuration(segments));
	const ridden = $derived(stretchWorkout(workout, extra));
	let elapsed = $state(0);
	/** The seconds Skip jumped over. */
	let shift = $state(0);
	const seconds = $derived(
		ride.road
			? Math.min(total, Math.max(0, ride.road(segments)))
			: Math.min(total, Math.max(0, elapsed + shift)),
	);
	const info = $derived(
		targetAt(segments, ftp, seconds, { bias: ride.bias() }),
	);
	/**
	 * No ERG target because this is a sprint — not because a guard is up. The
	 * ride's `targetWatts ?? 0` folds both into zero, and zero in ERG is a
	 * freewheel: the rider pedalled against nothing for the whole window (#1529).
	 */
	const sprinting = $derived(!info.done && info.segment?.kind === 'sprint');

	// The sprint window the screen draws (#1793), its own module: the
	// block under way or the one about to start, anchored once per block.
	const sprintWindow = createSprintWindow(() => ({
		segments,
		segment: info.segment,
		index: info.segmentIndex,
		clock: seconds,
		done: info.done,
		over: ride.over(),
	}));

	return {
		get segments() {
			return segments;
		},
		get total() {
			return total;
		},
		/** The workout with the minutes added: what the ride saves. */
		get workout() {
			return ridden;
		},
		/** The workout second. */
		get seconds() {
			return seconds;
		},
		get info() {
			return info;
		},
		get sprinting() {
			return sprinting;
		},
		/** The sprint block on screen, or the one about to be — null otherwise. */
		get window() {
			return sprintWindow.current;
		},
		/** Re-anchor the sprint window on where the clock is now. */
		sync() {
			sprintWindow.sync();
		},
		advance(by: number) {
			elapsed += by;
		},
		/**
		 * Jump to the start of the next block; false when there is none — or
		 * on a road, where the road decides where a block ends (#3499).
		 */
		skip(): boolean {
			const next = segments[info.segmentIndex + 1];
			if (ride.road) return false;
			if (!next) return false;
			shift += next.startSeconds - seconds;
			return true;
		},
		/**
		 * Lengthen the block under way by `by` seconds, wherever in it the
		 * rider is (#4445): its countdown grows, the blocks after it start
		 * that much later and the clock stays on its second. Never on a road,
		 * nor past the end.
		 */
		extend(by: number): boolean {
			if (ride.road || info.done || by <= 0) return false;
			const next = [...extra];
			next[info.segmentIndex] += by;
			extra = next;
			return true;
		},
	};
}
