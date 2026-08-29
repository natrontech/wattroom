/** Workout JSON per docs/SPEC.md — targets are fractions of FTP unless `watts` is given. */

export interface RampStep {
	type: 'warmup' | 'cooldown' | 'ramp';
	seconds: number;
	from: number;
	to: number;
}

export interface SteadyStep {
	type: 'steady';
	seconds: number;
	target?: number;
	watts?: number;
}

export interface RepeatStep {
	type: 'repeat';
	times: number;
	/**
	 * Repeats nest. `flatten()` has always recursed, but this type used to forbid it,
	 * which made over-unders — sets of alternating efforts — impossible to express
	 * without writing every rep out by hand.
	 */
	steps: WorkoutStep[];
}

/** Armed sprint moment: no ERG target — trainer flips to slope mode for the window. */
export interface SprintStep {
	type: 'sprint';
	seconds: number;
}

export type WorkoutStep = RampStep | SteadyStep | RepeatStep | SprintStep;

export interface Workout {
	name: string;
	author?: string;
	steps: WorkoutStep[];
}

/** One entry of the flattened timeline — repeats expanded, absolute offsets. */
export interface Segment {
	kind: 'ramp' | 'steady' | 'sprint';
	startSeconds: number;
	seconds: number;
	/** fractions of FTP at segment start/end (equal for steady); undefined for sprint */
	fromFraction?: number;
	toFraction?: number;
	/** absolute watts override (SteadyStep.watts) */
	watts?: number;
	/** index into the original (unexpanded) step list, for UI highlighting */
	stepIndex: number;
}

export interface TargetInfo {
	/** ERG watts to hold; null during sprint segments (slope mode owns the trainer) */
	targetWatts: number | null;
	segment: Segment;
	segmentIndex: number;
	secondsIntoSegment: number;
	secondsRemainingInSegment: number;
	secondsRemainingTotal: number;
	/** true when t is past the end of the workout */
	done: boolean;
}
