import { describe, expect, it } from 'vitest';
import { describeBlock } from '$lib/workout/block';
import { flatten, targetAt } from '$lib/workout/engine';
import type { Workout } from '$lib/workout/types';
import { isSnapshot } from './feed';
import { hudBlock } from './hud-block';

describe('the block the HUD is sent (#4212)', () => {
	const ftp = 250;
	const blockAt = (workout: Workout, t: number) => {
		const segments = flatten(workout);
		return describeBlock(targetAt(segments, ftp, t), segments, workout, ftp);
	};
	const intervals: Workout = {
		name: 'Threes',
		steps: [
			{ type: 'warmup', seconds: 120, from: 0.5, to: 0.7 },
			{
				type: 'repeat',
				times: 3,
				steps: [
					{ type: 'steady', seconds: 180, target: 1.05 },
					{ type: 'steady', seconds: 120, target: 0.6 },
				],
			},
		],
	};

	it("is slot 1's time left, NEXT and rep", () => {
		// 40 s into the second rep's effort.
		expect(hudBlock(blockAt(intervals, 120 + 300 + 40))).toEqual({
			secondsLeft: 140,
			next: { label: 'Endurance', watts: 150, seconds: 120 },
			rep: { index: 2, count: 3 },
		});
	});

	it('has no NEXT in the last block', () => {
		const last = hudBlock(blockAt(intervals, 120 + 900 - 30));
		expect(last).toMatchObject({ secondsLeft: 30, rep: { index: 3 } });
		expect(last?.next).toBeNull();
	});

	it('is absent where it would only repeat the clock', () => {
		const one: Workout = {
			name: 'Steady',
			steps: [{ type: 'steady', seconds: 1200, target: 0.7 }],
		};
		expect(hudBlock(blockAt(one, 60))).toBeUndefined();
		expect(hudBlock(null)).toBeUndefined();
	});

	it('crosses the channel whole, and an older HUD still takes the snapshot', () => {
		const snapshot = {
			at: 1,
			watts: 260,
			target: 263,
			remaining: 700,
			label: 'Threes',
			block: hudBlock(blockAt(intervals, 460)),
		};
		expect(structuredClone(snapshot)).toEqual(snapshot);
		expect(isSnapshot(snapshot)).toBe(true);
	});
});
