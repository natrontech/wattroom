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
type Parsed = { workout: Workout | null; segments: Segment[] };
const EMPTY: Parsed = { workout: null, segments: [] };
// The definition rides every tick (#1710) and the room's $derived re-ran
// this — JSON.parse, validate, flatten over up to 200 segments — once a
// second on every rider's machine. One definition, one parse.
let last: { json: string; parsed: Parsed } | null = null;

export function parseSharedWorkout(workoutJson: string | undefined): Parsed {
	if (!workoutJson) return EMPTY;
	if (last?.json === workoutJson) return last.parsed;
	let parsed: Parsed = EMPTY;
	try {
		const checked = validateWorkout(JSON.parse(workoutJson));
		if (checked.ok)
			parsed = { workout: checked.workout, segments: flatten(checked.workout) };
	} catch {
		parsed = EMPTY;
	}
	last = { json: workoutJson, parsed };
	return parsed;
}
