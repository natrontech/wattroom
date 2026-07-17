import { describe, expect, it } from 'vitest';
import { durationSeconds, flatten, targetAt } from './engine';
import type { Workout } from './types';

const FTP = 250;

const workout: Workout = {
	name: '4x30/30 with ramps',
	steps: [
		{ type: 'warmup', seconds: 300, from: 0.4, to: 0.7 },
		{
			type: 'repeat',
			times: 4,
			steps: [
				{ type: 'steady', seconds: 30, target: 1.2 },
				{ type: 'steady', seconds: 30, target: 0.5 },
			],
		},
		{ type: 'sprint', seconds: 15 },
		{ type: 'steady', seconds: 60, watts: 137 },
		{ type: 'cooldown', seconds: 120, from: 0.6, to: 0.35 },
	],
};

describe('flatten', () => {
	it('expands repeats into absolutely-positioned segments', () => {
		const segs = flatten(workout);
		expect(segs).toHaveLength(1 + 8 + 1 + 1 + 1);
		expect(segs[1]).toMatchObject({
			startSeconds: 300,
			seconds: 30,
			fromFraction: 1.2,
		});
		expect(segs[8]).toMatchObject({ startSeconds: 510, fromFraction: 0.5 });
		expect(segs[8].stepIndex).toBe(1); // all repeat children map to the repeat step
		expect(durationSeconds(workout)).toBe(300 + 240 + 15 + 60 + 120);
	});
});

describe('targetAt', () => {
	const segs = flatten(workout);

	it('interpolates ramps linearly and scales to FTP', () => {
		expect(targetAt(segs, FTP, 0).targetWatts).toBe(100); // 0.4 × 250
		expect(targetAt(segs, FTP, 150).targetWatts).toBe(Math.round(0.55 * FTP));
		expect(targetAt(segs, FTP, 299).targetWatts).toBeGreaterThan(170);
	});

	it('holds steady targets and honors absolute watts overrides', () => {
		expect(targetAt(segs, FTP, 300).targetWatts).toBe(300); // 1.2 × 250
		expect(targetAt(segs, FTP, 330).targetWatts).toBe(125); // 0.5 × 250
		expect(targetAt(segs, FTP, 556).targetWatts).toBe(137); // watts override ignores FTP
	});

	it('returns null target during sprint segments (slope mode owns the trainer)', () => {
		const sprint = targetAt(segs, FTP, 545);
		expect(sprint.targetWatts).toBeNull();
		expect(sprint.segment.kind).toBe('sprint');
	});

	it('applies intensity bias', () => {
		expect(targetAt(segs, FTP, 300, { bias: 1.05 }).targetWatts).toBe(315);
		expect(targetAt(segs, FTP, 300, { bias: 0.9 }).targetWatts).toBe(270);
	});

	it('reports progress and completion', () => {
		const mid = targetAt(segs, FTP, 310);
		expect(mid.secondsIntoSegment).toBe(10);
		expect(mid.secondsRemainingInSegment).toBe(20);
		expect(mid.secondsRemainingTotal).toBe(durationSeconds(workout) - 310);
		expect(mid.done).toBe(false);

		expect(targetAt(segs, FTP, durationSeconds(workout)).done).toBe(true);
		expect(targetAt(segs, FTP, 10_000).targetWatts).toBeNull();
	});

	it('handles empty workouts without exploding', () => {
		const empty = targetAt(flatten({ name: 'empty', steps: [] }), FTP, 0);
		expect(empty.done).toBe(true);
		expect(empty.targetWatts).toBeNull();
	});
});
