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
	/**
	 * Optional cadence band, rpm (#66) — display-only: the execution score
	 * stays power-based per docs/SPEC.md. One side may be omitted: "under 60"
	 * is { cadenceHigh: 60 }, "over 100" is { cadenceLow: 100 }.
	 */
	cadenceLow?: number;
	cadenceHigh?: number;
	/**
	 * Optional HR band, raw bpm (#67 flavour 1) — display-only and never
	 * scored (ADR-0008: no HR-derived competition). Raw bpm on purpose:
	 * these are personal workouts; %LTHR is the upgrade path if sharing
	 * ever wants it.
	 */
	hrLow?: number;
	hrHigh?: number;
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
	/** cadence band carried from the step (steady only, display-only) */
	cadenceLow?: number;
	cadenceHigh?: number;
	/** HR band carried from the step (steady only, display-only, bpm) */
	hrLow?: number;
	hrHigh?: number;
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
