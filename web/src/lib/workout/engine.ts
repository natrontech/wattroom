import type { Segment, TargetInfo, Workout, WorkoutStep } from './types';

/** Expand repeats into a flat, absolutely-positioned timeline. Pure. */
export function flatten(workout: Workout): Segment[] {
	const segments: Segment[] = [];
	let t = 0;

	const push = (step: WorkoutStep, stepIndex: number) => {
		switch (step.type) {
			case 'repeat':
				for (let i = 0; i < step.times; i++) {
					for (const inner of step.steps) push(inner, stepIndex);
				}
				break;
			case 'steady':
				segments.push({
					kind: 'steady',
					startSeconds: t,
					seconds: step.seconds,
					fromFraction: step.target,
					toFraction: step.target,
					watts: step.watts,
					cadenceLow: step.cadenceLow,
					cadenceHigh: step.cadenceHigh,
					hrLow: step.hrLow,
					hrHigh: step.hrHigh,
					stepIndex,
				});
				t += step.seconds;
				break;
			case 'sprint':
				segments.push({
					kind: 'sprint',
					startSeconds: t,
					seconds: step.seconds,
					stepIndex,
				});
				t += step.seconds;
				break;
			default:
				segments.push({
					kind: 'ramp',
					startSeconds: t,
					seconds: step.seconds,
					fromFraction: step.from,
					toFraction: step.to,
					stepIndex,
				});
				t += step.seconds;
		}
	};

	workout.steps.forEach(push);
	return segments;
}

export function durationSeconds(workout: Workout): number {
	const segs = flatten(workout);
	const last = segs.at(-1);
	return last ? last.startSeconds + last.seconds : 0;
}

export interface TargetOptions {
	/** intensity bias as a factor, 1.0 = as written (player exposes ±% in steps) */
	bias?: number;
}

/**
 * Target watts at second t for a rider with the given FTP. Pure — the player and
 * the room hub both call this; it must stay side-effect free.
 */
export function targetAt(
	segments: Segment[],
	ftp: number,
	t: number,
	opts: TargetOptions = {},
): TargetInfo {
	const bias = opts.bias ?? 1;
	const total = segments.length
		? segments[segments.length - 1].startSeconds +
			segments[segments.length - 1].seconds
		: 0;

	if (segments.length === 0 || t >= total) {
		const last = segments[segments.length - 1];
		return {
			targetWatts: null,
			segment: last,
			segmentIndex: Math.max(0, segments.length - 1),
			secondsIntoSegment: 0,
			secondsRemainingInSegment: 0,
			secondsRemainingTotal: 0,
			done: true,
		};
	}

	const clamped = Math.max(0, t);
	let index = segments.findIndex(
		(s) => clamped >= s.startSeconds && clamped < s.startSeconds + s.seconds,
	);
	if (index === -1) index = 0;
	const seg = segments[index];
	const into = clamped - seg.startSeconds;

	let targetWatts: number | null = null;
	if (seg.kind !== 'sprint') {
		if (seg.watts !== undefined) {
			targetWatts = seg.watts;
		} else {
			const from = seg.fromFraction ?? 0;
			const to = seg.toFraction ?? from;
			const fraction = from + (to - from) * (into / seg.seconds);
			targetWatts = fraction * ftp;
		}
		targetWatts = Math.round(targetWatts * bias);
	}

	return {
		targetWatts,
		segment: seg,
		segmentIndex: index,
		secondsIntoSegment: into,
		secondsRemainingInSegment: seg.seconds - into,
		secondsRemainingTotal: total - clamped,
		done: false,
	};
}
