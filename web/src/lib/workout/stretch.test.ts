import { describe, expect, it } from 'vitest';
import { flatten } from './engine';
import { stretchSegments, stretchWorkout } from './stretch';
import type { Segment, Workout } from './types';

/** The timeline without the tree paths, which name the written workout's steps. */
const timeline = (segments: Segment[]) =>
	segments.map(({ stepPath: _, ...rest }) => rest);

const intervals: Workout = {
	name: 'intervals',
	steps: [
		{ type: 'warmup', seconds: 300, from: 0.5, to: 0.75 },
		{
			type: 'repeat',
			times: 3,
			steps: [
				{ type: 'steady', seconds: 60, target: 1.2 },
				{ type: 'steady', seconds: 60, target: 0.5 },
			],
		},
		{ type: 'cooldown', seconds: 120, from: 0.6, to: 0.4 },
	],
};

describe('stretchWorkout', () => {
	it('is the workout itself until a block is lengthened', () => {
		const extra = flatten(intervals).map(() => 0);
		expect(stretchWorkout(intervals, extra)).toBe(intervals);
		const segments = flatten(intervals);
		expect(stretchSegments(segments, extra)).toBe(segments);
	});

	it('lengthens one pass of a repeat and keeps the others repeats', () => {
		// Blocks: warmup 0, then on/off 1–2, 3–4, 5–6, cooldown 7.
		const extra = [0, 0, 0, 0, 60, 0, 0, 0];
		const ridden = stretchWorkout(intervals, extra);
		expect(ridden.steps).toEqual([
			intervals.steps[0],
			{ ...intervals.steps[1], times: 1 },
			{ type: 'steady', seconds: 60, target: 1.2 },
			{ type: 'steady', seconds: 120, target: 0.5 },
			{ ...intervals.steps[1], times: 1 },
			intervals.steps[2],
		]);
	});

	it('saves the timeline the clock rides', () => {
		const extra = [60, 0, 120, 0, 0, 60, 0, 60];
		const segments = stretchSegments(flatten(intervals), extra);
		expect(timeline(flatten(stretchWorkout(intervals, extra)))).toEqual(
			timeline(segments),
		);
		// The blocks after a lengthened one start later by what it gained.
		expect(segments.map((s) => s.startSeconds)).toEqual([
			0, 360, 420, 600, 660, 720, 840, 900,
		]);
		// The paths still name the written workout's steps, for the graph.
		expect(segments.map((s) => s.stepPath)).toEqual(
			flatten(intervals).map((s) => s.stepPath),
		);
	});

	it('stretches a ramp over the longer block, its ends as written', () => {
		const ridden = stretchWorkout(intervals, [60, 0, 0, 0, 0, 0, 0, 0]);
		expect(ridden.steps[0]).toEqual({
			type: 'warmup',
			seconds: 360,
			from: 0.5,
			to: 0.75,
		});
	});

	it('writes out a lengthened pass inside a nested repeat', () => {
		const nested: Workout = {
			name: 'over-unders',
			steps: [
				{
					type: 'repeat',
					times: 2,
					steps: [
						{
							type: 'repeat',
							times: 2,
							steps: [
								{ type: 'steady', seconds: 30, target: 1.05 },
								{ type: 'steady', seconds: 30, target: 0.95 },
							],
						},
						{ type: 'steady', seconds: 120, target: 0.5 },
					],
				},
			],
		};
		// Blocks per outer pass: over, under, over, under, rest. The second
		// pass's first under.
		const extra = [0, 0, 0, 0, 0, 0, 60, 0, 0, 0];
		const ridden = stretchWorkout(nested, extra);
		expect(timeline(flatten(ridden))).toEqual(
			timeline(stretchSegments(flatten(nested), extra)),
		);
		expect(flatten(ridden).map((s) => s.seconds)).toEqual([
			30, 30, 30, 30, 120, 30, 90, 30, 30, 120,
		]);
	});
});
