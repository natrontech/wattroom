import { flatten } from '$lib/workout/engine';
import type { Segment } from '$lib/workout/types';
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
	if (!workoutJson) return [];
	try {
		const checked = validateWorkout(JSON.parse(workoutJson));
		return checked.ok ? flatten(checked.workout) : [];
	} catch {
		return [];
	}
}
