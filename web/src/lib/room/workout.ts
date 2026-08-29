import { flatten } from '$lib/workout/engine';
import type { Segment, Workout } from '$lib/workout/types';
import { validateWorkout } from '$lib/workout/validate';

/**
 * The shared workout arrives opaquely over the wire (the server owns the
 * clock, the clients own the targets) — validated like any untrusted input
 * before flatten() recurses into it. Extracted when the spectator view became
 * its second consumer.
 */
export function parseSharedSegments(
	workoutJson: string | undefined,
): Segment[] {
	return parseSharedWorkout(workoutJson).segments;
}

/** Workout and segments together — the block strip needs step types for labels. */
export function parseSharedWorkout(workoutJson: string | undefined): {
	workout: Workout | null;
	segments: Segment[];
} {
	if (!workoutJson) return { workout: null, segments: [] };
	try {
		const checked = validateWorkout(JSON.parse(workoutJson));
		return checked.ok
			? { workout: checked.workout, segments: flatten(checked.workout) }
			: { workout: null, segments: [] };
	} catch {
		return { workout: null, segments: [] };
	}
}
