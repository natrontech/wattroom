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
