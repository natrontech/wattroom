import { flatten, targetAt } from './engine';
import { createSprintWindow } from './sprint-window.svelte';
import type { Segment, Workout } from './types';

/**
 * Where on its workout a solo ride is: the clock, what the workout asks
 * there, and the sprint window the screen draws. Skip and extend move the
 * clock, never the workout (#13).
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
	const segments: Segment[] = flatten(workout);
	const total = segments.reduce(
		(t, s) => Math.max(t, s.startSeconds + s.seconds),
		0,
	);
	let elapsed = $state(0);
	/** Per-segment time shifts from skip/extend, so the timeline stays authoritative. */
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
		segments,
		total,
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
		/** Jump to the start of the next block; false when there is none. */
		skip(): boolean {
			const next = segments[info.segmentIndex + 1];
			if (!next) return false;
			shift += next.startSeconds - seconds;
			return true;
		},
		/**
		 * Hold the current block longer by rewinding the workout clock, which pushes
		 * this block's end out along with everything after it.
		 * Known edge: within the first `seconds` of the whole workout the clock floors
		 * at zero, so an early extend gives less than asked. Fixing it properly needs
		 * per-segment durations rather than one global shift — not worth it until a
		 * rider complains.
		 */
		extend(by: number) {
			shift -= by;
		},
	};
}
