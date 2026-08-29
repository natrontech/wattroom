import type { RepeatStep, Workout, WorkoutStep } from './types';

/**
 * Validates a workout parsed from somewhere untrusted — localStorage, a pasted
 * file, an import. The editor writes to localStorage, which is user-editable and
 * survives across app versions, so anything read back has to be checked rather
 * than believed.
 */
export const LIMITS = {
	nameLength: 80,
	/** Repeats nest, so a hand-edited file could nest deeply enough to hang flatten(). */
	maxDepth: 4,
	maxSteps: 200,
	minSeconds: 5,
	maxSeconds: 4 * 60 * 60,
	/** 300 % FTP — beyond any sustainable prescription, and past the graph ceiling. */
	maxFraction: 3,
	maxWatts: 3000,
	maxRepeats: 50,
} as const;

export type Validation =
	{ ok: true; workout: Workout } | { ok: false; error: string };

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkSeconds(value: unknown, where: string): string | null {
	if (typeof value !== 'number' || !Number.isFinite(value))
		return `${where}: seconds must be a number`;
	if (value < LIMITS.minSeconds)
		return `${where}: steps shorter than ${LIMITS.minSeconds}s are not rideable`;
	if (value > LIMITS.maxSeconds)
		return `${where}: step is longer than ${LIMITS.maxSeconds / 3600} hours`;
	return null;
}

function checkFraction(
	value: unknown,
	where: string,
	field: string,
): string | null {
	if (typeof value !== 'number' || !Number.isFinite(value))
		return `${where}: ${field} must be a number`;
	if (value <= 0) return `${where}: ${field} must be above 0`;
	if (value > LIMITS.maxFraction) {
		return `${where}: ${field} is ${Math.round(value * 100)}% of FTP, above the ${LIMITS.maxFraction * 100}% ceiling`;
	}
	return null;
}

function checkStep(
	value: unknown,
	where: string,
	depth: number,
): string | null {
	if (!isObject(value)) return `${where}: not a step`;

	switch (value.type) {
		case 'warmup':
		case 'cooldown':
		case 'ramp':
			return (
				checkSeconds(value.seconds, where) ??
				checkFraction(value.from, where, 'from') ??
				checkFraction(value.to, where, 'to')
			);

		case 'steady': {
			const seconds = checkSeconds(value.seconds, where);
			if (seconds) return seconds;
			if (value.watts !== undefined) {
				if (typeof value.watts !== 'number' || !Number.isFinite(value.watts)) {
					return `${where}: watts must be a number`;
				}
				if (value.watts <= 0 || value.watts > LIMITS.maxWatts) {
					return `${where}: ${value.watts} W is outside 1–${LIMITS.maxWatts}`;
				}
				return null;
			}
			return checkFraction(value.target, where, 'target');
		}

		case 'sprint':
			return checkSeconds(value.seconds, where);

		case 'repeat': {
			if (depth >= LIMITS.maxDepth) {
				return `${where}: repeats are nested more than ${LIMITS.maxDepth} deep`;
			}
			if (typeof value.times !== 'number' || !Number.isInteger(value.times)) {
				return `${where}: times must be a whole number`;
			}
			if (value.times < 1 || value.times > LIMITS.maxRepeats) {
				return `${where}: ${value.times} repeats is outside 1–${LIMITS.maxRepeats}`;
			}
			if (!Array.isArray(value.steps) || value.steps.length === 0) {
				return `${where}: a repeat needs at least one step`;
			}
			for (const [i, inner] of value.steps.entries()) {
				const error = checkStep(inner, `${where} → step ${i + 1}`, depth + 1);
				if (error) return error;
			}
			return null;
		}

		default:
			return `${where}: unknown step type ${JSON.stringify(value.type)}`;
	}
}

/** Total steps after expanding repeats, so a small file cannot expand into a huge one. */
function countExpanded(steps: WorkoutStep[]): number {
	return steps.reduce((total, step) => {
		if (step.type === 'repeat') {
			return total + step.times * countExpanded((step as RepeatStep).steps);
		}
		return total + 1;
	}, 0);
}

export function validateWorkout(value: unknown): Validation {
	if (!isObject(value)) return { ok: false, error: 'That is not a workout.' };

	const name = value.name;
	if (typeof name !== 'string' || name.trim() === '') {
		return { ok: false, error: 'A workout needs a name.' };
	}
	if (name.length > LIMITS.nameLength) {
		return {
			ok: false,
			error: `Names are limited to ${LIMITS.nameLength} characters.`,
		};
	}
	if (!Array.isArray(value.steps) || value.steps.length === 0) {
		return { ok: false, error: 'A workout needs at least one step.' };
	}

	for (const [i, step] of value.steps.entries()) {
		const error = checkStep(step, `Step ${i + 1}`, 0);
		if (error) return { ok: false, error };
	}

	const expanded = countExpanded(value.steps as WorkoutStep[]);
	if (expanded > LIMITS.maxSteps) {
		return {
			ok: false,
			error: `That expands to ${expanded} intervals, above the ${LIMITS.maxSteps} limit.`,
		};
	}

	return { ok: true, workout: value as unknown as Workout };
}
