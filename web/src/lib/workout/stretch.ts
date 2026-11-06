import type { Segment, Workout, WorkoutStep } from './types';

/**
 * A workout lengthened block by block (#4445): +1 min adds its seconds to the
 * block the rider is in, and every block after it starts that much later.
 * `extra` is indexed as flatten()'s segments, one entry per block ridden, so
 * the second pass of a repeat stretches without the others.
 */

/** Whether any block from `from`, for `count` blocks, was lengthened. */
const stretched = (extra: readonly number[], from: number, count: number) =>
	extra.slice(from, from + count).some((s) => s > 0);

/** The blocks one step expands to, as flatten() counts them. */
function blocksOf(step: WorkoutStep): number {
	if (step.type !== 'repeat') return 1;
	return step.times * step.steps.reduce((n, s) => n + blocksOf(s), 0);
}

/**
 * The segments with each block `extra[i]` seconds longer and the ones after
 * it moved on by as much; `segments` itself when nothing was added.
 */
export function stretchSegments(
	segments: Segment[],
	extra: readonly number[],
): Segment[] {
	if (!stretched(extra, 0, segments.length)) return segments;
	let moved = 0;
	return segments.map((seg, i) => {
		const added = extra[i] ?? 0;
		const out = {
			...seg,
			startSeconds: seg.startSeconds + moved,
			seconds: seg.seconds + added,
		};
		moved += added;
		return out;
	});
}

function stretchSteps(
	steps: readonly WorkoutStep[],
	extra: readonly number[],
	from: number,
): WorkoutStep[] {
	const out: WorkoutStep[] = [];
	let at = from;
	for (const step of steps) {
		const count = blocksOf(step);
		if (!stretched(extra, at, count)) out.push(step);
		else if (step.type !== 'repeat')
			// A ramp keeps its ends and climbs over the longer block.
			out.push({ ...step, seconds: step.seconds + extra[at] });
		else {
			// The passes that were lengthened are written out; the runs of
			// passes between them stay repeats.
			const pass = count / step.times;
			let plain = 0;
			const flush = () => {
				if (plain > 0) out.push({ ...step, times: plain });
				plain = 0;
			};
			for (let p = 0; p < step.times; p++) {
				const start = at + p * pass;
				if (!stretched(extra, start, pass)) {
					plain++;
					continue;
				}
				flush();
				out.push(...stretchSteps(step.steps, extra, start));
			}
			flush();
		}
		at += count;
	}
	return out;
}

/**
 * The workout as it is ridden with `extra`: what the ride saves, so the
 * server scores and draws each recorded second against the block it was
 * ridden in. `workout` itself when nothing was added.
 */
export function stretchWorkout(
	workout: Workout,
	extra: readonly number[],
): Workout {
	if (!stretched(extra, 0, extra.length)) return workout;
	return { ...workout, steps: stretchSteps(workout.steps, extra, 0) };
}
