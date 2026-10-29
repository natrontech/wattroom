import { MaxRideSamples, MaxWorkoutNameChars } from '$lib/protocol';
import { FREE_RIDE_NAME } from '$lib/ride/free-ride.svelte';
import { durationSeconds } from './engine';
import type { Workout, WorkoutRoad, WorkoutStep } from './types';

/** One workout of a ride, and the furthest workout second ridden on it. */
export interface RiddenPart {
	workout: Workout;
	reached: number;
}

/**
 * No workout, on a road (#4257): the road at its own grade in SIM, open to
 * the six hours a ride may last, until End or another workout.
 */
export function openRoad(road: WorkoutRoad): Workout {
	return {
		name: FREE_RIDE_NAME,
		steps: [{ type: 'road', seconds: MaxRideSamples }],
		road,
	};
}

/** The road with no workout on it: no blocks to skip, no time left to count. */
export function isOpenRoad(workout: Workout): boolean {
	const [only, ...rest] = workout.steps;
	return (
		rest.length === 0 &&
		only?.type === 'road' &&
		only.seconds === MaxRideSamples
	);
}

/** The steps of `steps` up to `seconds` in, the one it falls in cut short. */
export function cutSteps(
	steps: readonly WorkoutStep[],
	seconds: number,
): WorkoutStep[] {
	const out: WorkoutStep[] = [];
	let left = seconds;
	for (const step of steps) {
		if (left <= 0) break;
		const length = durationSeconds({ name: '', steps: [step] });
		if (length <= left) {
			out.push(step);
			left -= length;
			continue;
		}
		if (step.type === 'repeat') {
			const once = length / step.times;
			const whole = Math.floor(left / once);
			if (whole > 0) out.push({ ...step, times: whole });
			out.push(...cutSteps(step.steps, left - whole * once));
		} else if (
			step.type === 'warmup' ||
			step.type === 'cooldown' ||
			step.type === 'ramp'
		) {
			const to = step.from + ((step.to - step.from) * left) / step.seconds;
			out.push({ ...step, seconds: left, to });
		} else out.push({ ...step, seconds: left });
		break;
	}
	return out;
}

/**
 * A ride's workouts as the one it saves (#4257): each cut where the rider
 * left it, one after another, under all their names. The recorded clock
 * already runs on across them (ride-record), so the server scores and draws
 * it as it scores one. A ride on one workout saves that workout as it was.
 */
export function riddenWorkout(parts: readonly RiddenPart[]): Workout {
	if (parts.length === 1) return parts[0].workout;
	const name = parts.map((p) => p.workout.name).join(' + ');
	const road = parts[0].workout.road;
	const steps = parts.flatMap((p) => cutSteps(p.workout.steps, p.reached));
	return {
		name:
			name.length > MaxWorkoutNameChars
				? `${name.slice(0, MaxWorkoutNameChars - 1)}…`
				: name,
		steps,
		...(parts.every((p) => p.workout.unscored) && { unscored: true }),
		// One road, ridden on through every change; a leg's pins are its own.
		...(road && { road: { ...road, stepEndM: undefined } }),
	};
}
