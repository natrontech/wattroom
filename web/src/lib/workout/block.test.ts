import { describe, expect, it } from 'vitest';
import { describeBlock } from './block';
import { flatten, targetAt } from './engine';
import type { Workout } from './types';

// A trimmed rider is told the watts the trainer will hold (#2835): the
// target is the prescribed fraction × their bias (docs/SPEC.md), and the
// next block read the prescribed number beside a biased current one.
describe('describeBlock under a trim', () => {
	const workout: Workout = {
		name: 'Two',
		author: 'test',
		steps: [
			{ type: 'steady', seconds: 60, target: 0.6 },
			{ type: 'steady', seconds: 60, target: 1.0 },
			{ type: 'steady', seconds: 60, watts: 300 },
		],
	};
	const segments = flatten(workout);
	const ftp = 250;

	it('says the next block as the trainer will hold it', () => {
		for (const bias of [0.9, 1, 1.1]) {
			const now = targetAt(segments, ftp, 10, { bias });
			const next = targetAt(segments, ftp, 70, { bias });
			const block = describeBlock(now, segments, workout, ftp);
			expect(block.watts).toBe(now.targetWatts);
			expect(block.next?.watts).toBe(next.targetWatts);
		}
	});

	it('trims a block given in absolute watts too, as targetAt does', () => {
		const now = targetAt(segments, ftp, 70, { bias: 0.9 });
		expect(describeBlock(now, segments, workout, ftp).next?.watts).toBe(270);
	});
});

// Slot 1 (#3090): the target with its band, where you are in a repeat, and
// for a few seconds after a block, how that block went.
describe('describeBlock for slot 1', () => {
	const workout: Workout = {
		name: 'Reps',
		author: 'test',
		steps: [
			{ type: 'steady', seconds: 60, target: 0.5 },
			{
				type: 'repeat',
				times: 3,
				steps: [
					{ type: 'steady', seconds: 60, target: 1.0 },
					{ type: 'steady', seconds: 30, target: 0.5 },
				],
			},
		],
	};
	const segments = flatten(workout);
	const ftp = 200;
	const at = (t: number, trace: { t: number; w: number }[] = []) =>
		describeBlock(targetAt(segments, ftp, t), segments, workout, ftp, trace);

	it('gives the target its tolerance band', () => {
		const block = at(70);
		expect(block.watts).toBe(200);
		expect(block.band).toEqual({ low: 190, high: 210 });
	});

	it('counts the passes of a repeated step, and none outside a repeat', () => {
		expect(at(10).rep).toBeUndefined();
		expect(at(70).rep).toEqual({ index: 1, count: 3 });
		expect(at(60 + 90 + 10).rep).toEqual({ index: 2, count: 3 });
		expect(at(60 + 90 * 2 + 70).rep).toEqual({ index: 3, count: 3 });
	});

	it('says how the last block went, for its first seconds only', () => {
		// The warm-up held 100 W for 60 s, the last 15 of them at 150.
		const trace = Array.from({ length: 60 }, (_, t) => ({
			t,
			w: t < 45 ? 100 : 150,
		}));
		expect(at(62, trace).last).toEqual({ watts: 113, onTarget: 75 });
		expect(at(60 + 6, trace).last).toBeNull();
		expect(at(62).last).toBeNull();
	});
});
