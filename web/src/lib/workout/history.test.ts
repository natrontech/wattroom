import { beforeEach, describe, expect, it } from 'vitest';
import { changedPaths, createHistory, type Snapshot } from './history.svelte';
import { addInto, duplicate, move, remove } from './tree';
import type { RepeatStep, SteadyStep, Workout } from './types';

const sheet = (): Workout => ({
	name: 'Test',
	steps: [
		{ type: 'steady', seconds: 600, target: 0.6 },
		{
			type: 'repeat',
			times: 3,
			steps: [{ type: 'steady', seconds: 120, target: 1.0 }],
		},
	],
});

const snap = (
	workout: Workout,
	selected: number[] | null = null,
): Snapshot => ({
	workout: JSON.parse(JSON.stringify(workout)) as Workout,
	selected,
});

/** A clock the test moves by hand, so coalescing is tested without waiting. */
let clock = 0;
const now = () => clock;
beforeEach(() => (clock = 0));

describe('changedPaths', () => {
	it('names the single leaf that moved', () => {
		const a = sheet();
		const b = sheet();
		(b.steps[0] as SteadyStep).seconds = 700;
		expect(changedPaths(a, b)).toEqual(['steps.0.seconds']);
	});

	it('reports two and stops — a delete is never one field', () => {
		const a = sheet();
		const b = sheet();
		remove(b, [0]);
		expect(changedPaths(a, b).length).toBe(2);
	});

	it('is empty for equal sheets', () => {
		expect(changedPaths(sheet(), sheet())).toEqual([]);
	});
});

describe('undo and redo', () => {
	it('steps back and forward through every kind of edit', () => {
		const w = sheet();
		const history = createHistory(snap(w), now);
		const states: Workout[] = [];

		const edit = (fn: () => void) => {
			clock += 1000; // each edit its own entry
			fn();
			history.record(snap(w));
			states.push(JSON.parse(JSON.stringify(w)) as Workout);
		};

		edit(() => addInto(w, [1], 'ramp'));
		edit(() => duplicate(w, [0]));
		// The repeat, not the fresh copy: swapping a step with its own duplicate
		// leaves the sheet identical, and an edit that changes nothing is
		// correctly not an undo step.
		edit(() => move(w, [2], -1));
		edit(() => remove(w, [0]));
		edit(() => (w.name = 'Renamed'));

		expect(history.canUndo).toBe(true);
		expect(history.canRedo).toBe(false);

		// Back through all five, landing on the sheet we started from.
		for (let i = states.length - 2; i >= 0; i--) {
			expect(history.undo()?.workout).toEqual(states[i]);
		}
		expect(history.undo()?.workout).toEqual(sheet());
		expect(history.undo()).toBeNull();
		expect(history.canUndo).toBe(false);

		// And forward again through the same five.
		for (const state of states) expect(history.redo()?.workout).toEqual(state);
		expect(history.redo()).toBeNull();
	});

	it('restores the selection a delete took away', () => {
		const w = sheet();
		const history = createHistory(snap(w, [1, 0]), now);
		clock += 1000;
		remove(w, [1, 0]);
		history.record(snap(w, null));

		const back = history.undo();
		expect(back?.selected).toEqual([1, 0]);
		expect((back?.workout.steps[1] as RepeatStep).steps).toHaveLength(1);
	});

	it('hands out copies, so editing the sheet cannot rewrite history', () => {
		const w = sheet();
		const history = createHistory(snap(w), now);
		clock += 1000;
		(w.steps[0] as SteadyStep).seconds = 999;
		history.record(snap(w));

		const back = history.undo()!;
		(back.workout.steps[0] as SteadyStep).seconds = 1;
		expect((history.redo()!.workout.steps[0] as SteadyStep).seconds).toBe(999);
	});
});

describe('coalescing', () => {
	it('folds fast edits to one field into a single entry', () => {
		const w = sheet();
		const history = createHistory(snap(w), now);
		for (const seconds of [610, 620, 630]) {
			clock += 100;
			(w.steps[0] as SteadyStep).seconds = seconds;
			history.record(snap(w));
		}
		expect(history.undo()?.workout).toEqual(sheet());
		expect(history.canUndo).toBe(false);
	});

	it('starts a new entry once the rider pauses', () => {
		const w = sheet();
		const history = createHistory(snap(w), now);
		clock += 100;
		(w.steps[0] as SteadyStep).seconds = 610;
		history.record(snap(w));
		clock += 5000;
		(w.steps[0] as SteadyStep).seconds = 620;
		history.record(snap(w));

		expect((history.undo()?.workout.steps[0] as SteadyStep).seconds).toBe(610);
		expect((history.undo()?.workout.steps[0] as SteadyStep).seconds).toBe(600);
	});

	it('keeps two different fields apart however fast they are typed', () => {
		const w = sheet();
		const history = createHistory(snap(w), now);
		clock += 100;
		(w.steps[0] as SteadyStep).seconds = 610;
		history.record(snap(w));
		clock += 10;
		(w.steps[0] as SteadyStep).target = 0.7;
		history.record(snap(w));

		expect(history.undo()?.workout).toEqual({
			...sheet(),
			steps: [{ type: 'steady', seconds: 610, target: 0.6 }, sheet().steps[1]],
		});
	});

	it('records nothing when only the selection moved', () => {
		const w = sheet();
		const history = createHistory(snap(w, [0]), now);
		clock += 1000;
		history.record(snap(w, [1]));
		expect(history.canUndo).toBe(false);
	});
});

describe('redo invalidation and reset', () => {
	it('drops the redo stack on a new edit', () => {
		const w = sheet();
		const history = createHistory(snap(w), now);
		clock += 1000;
		(w.steps[0] as SteadyStep).seconds = 700;
		history.record(snap(w));
		history.undo();
		expect(history.canRedo).toBe(true);

		clock += 1000;
		w.name = 'Something else';
		history.record(snap(w));
		expect(history.canRedo).toBe(false);
	});

	it('reset starts over — a saved workout arriving is not an edit', () => {
		const history = createHistory(snap(sheet()), now);
		clock += 1000;
		const loaded = sheet();
		loaded.name = 'From the shelf';
		history.reset(snap(loaded));
		expect(history.canUndo).toBe(false);
		expect(history.undo()).toBeNull();
	});
});
