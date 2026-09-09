/**
 * Editing a workout's step tree by path (#1004).
 *
 * A path addresses one node: `[i]` a top-level step, `[i, j]` a step inside a
 * repeat, deeper for nested repeats. Every operation here works the same at
 * every depth — the editor's affordances used to stop at the top level while
 * the model underneath never did.
 */
import type { Workout, WorkoutStep } from './types';

export type StepType = 'steady' | 'ramp' | 'sprint' | 'repeat';

export const STEP_TYPES: StepType[] = ['steady', 'ramp', 'repeat', 'sprint'];

// ponytail: JSON round-trip to clone a step — workout JSON is numbers and
// strings by definition (docs/SPEC.md), and unlike structuredClone it does not
// care that it was handed a $state proxy.
const clone = (step: WorkoutStep): WorkoutStep =>
	JSON.parse(JSON.stringify(step)) as WorkoutStep;

/** A fresh step of each type, with the defaults the editor offers. */
function newStep(type: StepType): WorkoutStep {
	switch (type) {
		case 'ramp':
			return { type: 'ramp', seconds: 300, from: 0.5, to: 0.8 };
		case 'sprint':
			return { type: 'sprint', seconds: 15 };
		case 'repeat':
			return {
				type: 'repeat',
				times: 3,
				steps: [
					{ type: 'steady', seconds: 300, target: 0.9 },
					{ type: 'steady', seconds: 180, target: 0.5 },
				],
			};
		default:
			return { type: 'steady', seconds: 300, target: 0.75 };
	}
}

export function stepAt(
	workout: Workout,
	path: number[],
): WorkoutStep | undefined {
	let step: WorkoutStep | undefined = workout.steps[path[0]];
	for (const i of path.slice(1)) {
		if (step?.type !== 'repeat') return undefined;
		step = step.steps[i];
	}
	return step;
}

/** The array a path's last index points into: the top level, or a repeat's children. */
function siblingsOf(workout: Workout, path: number[]): WorkoutStep[] {
	if (path.length <= 1) return workout.steps;
	const parent = stepAt(workout, path.slice(0, -1));
	return parent?.type === 'repeat' ? parent.steps : [];
}

/** Two paths address siblings — the only pair a drag may reorder. */
export function sameParent(a: number[], b: number[]): boolean {
	return (
		a.length === b.length &&
		a.slice(0, -1).join('.') === b.slice(0, -1).join('.')
	);
}

/** Appends a step to the top level. Returns its path. */
export function append(workout: Workout, type: StepType): number[] {
	workout.steps.push(newStep(type));
	return [workout.steps.length - 1];
}

/** Adds a step of `type` inside the repeat at `path`. Returns the new step's path. */
export function addInto(
	workout: Workout,
	path: number[],
	type: StepType,
): number[] | null {
	const repeat = stepAt(workout, path);
	if (repeat?.type !== 'repeat') return null;
	repeat.steps.push(newStep(type));
	return [...path, repeat.steps.length - 1];
}

/** Copies the step at `path` in directly after itself. Returns the copy's path. */
export function duplicate(workout: Workout, path: number[]): number[] | null {
	const step = stepAt(workout, path);
	if (!step) return null;
	const at = path[path.length - 1] + 1;
	siblingsOf(workout, path).splice(at, 0, clone(step));
	return [...path.slice(0, -1), at];
}

/** Swaps the step at `path` with the sibling `by` places away. Returns its new path. */
export function move(
	workout: Workout,
	path: number[],
	by: number,
): number[] | null {
	const siblings = siblingsOf(workout, path);
	const index = path[path.length - 1];
	const to = index + by;
	if (to < 0 || to >= siblings.length) return null;
	[siblings[index], siblings[to]] = [siblings[to], siblings[index]];
	return [...path.slice(0, -1), to];
}

export function remove(workout: Workout, path: number[]): void {
	siblingsOf(workout, path).splice(path[path.length - 1], 1);
}

/**
 * Removes the step and says what to select next: the neighbour that took its
 * place, else the last sibling, else the parent, else nothing. Deleting used
 * to drop the selection to null and the focus to <body> (ux.md; #1392).
 */
export function removeAndSelect(
	workout: Workout,
	path: number[],
): number[] | null {
	remove(workout, path);
	const siblings = siblingsOf(workout, path);
	const index = path[path.length - 1];
	if (siblings.length > 0) {
		return [...path.slice(0, -1), Math.min(index, siblings.length - 1)];
	}
	return path.length > 1 ? path.slice(0, -1) : null;
}

/**
 * Moves the step at `from` to sit before sibling index `to` (the drop line sits
 * between rows, so `to` may be one past the end).
 *
 * ponytail: same parent only — the caller refuses a drop across parents, since
 * a one-column list has no gap that reads as "out of the repeat" rather than
 * "after its last child". Move up/down and duplicate-then-delete cover it; a
 * real cross-parent drag wants the drop zones #1006 is drawing anyway.
 */
export function reorder(
	workout: Workout,
	from: number[],
	to: number,
): number[] | null {
	const siblings = siblingsOf(workout, from);
	const index = from[from.length - 1];
	const at = to > index ? to - 1 : to;
	if (at === index || at < 0 || at >= siblings.length) return null;
	const [moved] = siblings.splice(index, 1);
	siblings.splice(at, 0, moved);
	return [...from.slice(0, -1), at];
}

/** Wraps the step at `path` in a 2× repeat. Returns the step's path inside it. */
export function wrapInRepeat(
	workout: Workout,
	path: number[],
): number[] | null {
	const step = stepAt(workout, path);
	if (!step) return null;
	const at = path[path.length - 1];
	siblingsOf(workout, path)[at] = {
		type: 'repeat',
		times: 2,
		steps: [clone(step)],
	};
	return [...path, 0];
}
