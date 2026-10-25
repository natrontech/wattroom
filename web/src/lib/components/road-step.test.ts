import { expect, it } from 'vitest';
import { applyEdit, grabAt } from './graph-edit';
import { plannedZoneSeconds, zoneOfSegment, zoneOfStep } from './zones';
import { flatten } from '$lib/workout/engine';
import type { Workout } from '$lib/workout/types';

it('gives an untargeted road no planned power zone or draggable target', () => {
	const workout: Workout = {
		name: 'Road',
		steps: [{ type: 'road', seconds: 60 }],
	};
	const segments = flatten(workout);
	expect(zoneOfStep(workout.steps[0], 250)).toBe(0);
	expect(zoneOfSegment(segments[0], 250)).toBe(0);
	expect(plannedZoneSeconds(segments, 250).reduce((a, b) => a + b, 0)).toBe(0);
	expect(
		grabAt(200, 50, { kind: 'road', x0: 100, x1: 300, yFrom: 50, yTo: 50 }),
	).toBe('reorder');
	const before = structuredClone(workout);
	applyEdit(workout, { kind: 'target', path: [0], fraction: 1 }, 250);
	applyEdit(workout, { kind: 'rampFrom', path: [0], fraction: 1 }, 250);
	expect(workout).toEqual(before);
});
