import { describe, expect, it } from 'vitest';
import { flatten } from './engine';
import {
	addInto,
	duplicate,
	move,
	remove,
	reorder,
	sameParent,
	stepAt,
	STEP_TYPES,
	wrapInRepeat,
} from './tree';
import type { RepeatStep, SteadyStep, Workout } from './types';

/** 10 min steady, then 3 × (2 min hard / 1 min easy). */
const nested = (): Workout => ({
	name: 'Test',
	steps: [
		{ type: 'steady', seconds: 600, target: 0.6 },
		{
			type: 'repeat',
			times: 3,
			steps: [
				{ type: 'steady', seconds: 120, target: 1.0 },
				{ type: 'steady', seconds: 60, target: 0.5 },
			],
		},
	],
});

const inner = (w: Workout) => (w.steps[1] as RepeatStep).steps;

describe('stepAt', () => {
	it('walks to any depth and refuses a path through a non-repeat', () => {
		const w = nested();
		expect(stepAt(w, [0])?.type).toBe('steady');
		expect((stepAt(w, [1, 1]) as SteadyStep).target).toBe(0.5);
		expect(stepAt(w, [0, 0])).toBeUndefined();
		expect(stepAt(w, [1, 9])).toBeUndefined();
	});
});

describe('duplicate', () => {
	it('copies a repeat child in beside it, and the copy is independent', () => {
		const w = nested();
		expect(duplicate(w, [1, 0])).toEqual([1, 1]);
		expect(inner(w)).toHaveLength(3);
		expect((inner(w)[1] as SteadyStep).target).toBe(1.0);

		(inner(w)[1] as SteadyStep).target = 0.8;
		expect((inner(w)[0] as SteadyStep).target).toBe(1.0);
	});

	it('copies a whole repeat block, children and all', () => {
		const w = nested();
		expect(duplicate(w, [1])).toEqual([2]);
		expect(w.steps).toHaveLength(3);
		expect((w.steps[2] as RepeatStep).steps).toHaveLength(2);

		(w.steps[2] as RepeatStep).times = 9;
		expect((w.steps[1] as RepeatStep).times).toBe(3);
	});
});

describe('move and remove', () => {
	it('swaps siblings inside a repeat without touching the top level', () => {
		const w = nested();
		expect(move(w, [1, 0], 1)).toEqual([1, 1]);
		expect((inner(w)[0] as SteadyStep).target).toBe(0.5);
		expect(w.steps).toHaveLength(2);
	});

	it('refuses to move past either end', () => {
		const w = nested();
		expect(move(w, [1, 0], -1)).toBeNull();
		expect(move(w, [1, 1], 1)).toBeNull();
		expect(inner(w)).toHaveLength(2);
	});

	it('removes a repeat child', () => {
		const w = nested();
		remove(w, [1, 0]);
		expect(inner(w)).toHaveLength(1);
		expect((inner(w)[0] as SteadyStep).target).toBe(0.5);
	});
});

describe('reorder', () => {
	it('drags a step to a new place among its siblings, at depth', () => {
		const w = nested();
		addInto(w, [1], 'sprint');
		// Drop the last child (index 2) onto the line above the first.
		expect(reorder(w, [1, 2], 0)).toEqual([1, 0]);
		expect(inner(w).map((s) => s.type)).toEqual(['sprint', 'steady', 'steady']);
	});

	it('is a no-op when the step lands where it already is', () => {
		const w = nested();
		expect(reorder(w, [1, 0], 0)).toBeNull();
		expect(reorder(w, [1, 0], 1)).toBeNull();
	});

	it('only ever offers siblings as a drop target', () => {
		expect(sameParent([1, 0], [1, 1])).toBe(true);
		expect(sameParent([1, 0], [0])).toBe(false);
		expect(sameParent([0], [1])).toBe(true);
	});
});

describe('addInto', () => {
	it('adds every step type inside a repeat, not steady only', () => {
		const w = nested();
		for (const type of STEP_TYPES) expect(addInto(w, [1], type)).not.toBeNull();
		expect(inner(w).map((s) => s.type)).toEqual([
			'steady',
			'steady',
			...STEP_TYPES,
		]);
	});

	it('refuses a path that is not a repeat', () => {
		const w = nested();
		expect(addInto(w, [0], 'ramp')).toBeNull();
	});
});

describe('wrapInRepeat', () => {
	it('wraps a step in place and hands back the path inside', () => {
		const w = nested();
		expect(wrapInRepeat(w, [0])).toEqual([0, 0]);
		const wrapped = w.steps[0] as RepeatStep;
		expect(wrapped.type).toBe('repeat');
		expect((wrapped.steps[0] as SteadyStep).seconds).toBe(600);
	});
});

describe('the path a segment carries', () => {
	it('round-trips: every segment names the step that produced it', () => {
		const w = nested();
		for (const seg of flatten(w)) expect(stepAt(w, seg.stepPath)).toBeDefined();
	});

	it('gives a repeat child its own path, not its parent index', () => {
		const segments = flatten(nested());
		expect(segments[0].stepPath).toEqual([0]);
		// 3 reps × 2 children: every rep points back at the same two nodes.
		expect(segments.slice(1).map((s) => s.stepPath)).toEqual([
			[1, 0],
			[1, 1],
			[1, 0],
			[1, 1],
			[1, 0],
			[1, 1],
		]);
	});
});
