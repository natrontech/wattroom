import { describe, expect, it } from 'vitest';
import { flatten } from './engine';
import { createRideClock } from './ride-clock.svelte';
import type { Workout } from './types';

const workout: Workout = {
	name: 'three blocks',
	steps: [
		{ type: 'steady', seconds: 120, target: 0.5 },
		{ type: 'steady', seconds: 120, target: 1.0 },
		{ type: 'steady', seconds: 60, target: 0.6 },
	],
};

const clockOn = (w = workout) =>
	createRideClock(w, 200, { bias: () => 1, over: () => false });

describe('+1 min (#4445)', () => {
	it('keeps the block a rider just skipped to, and adds a minute to its countdown', () => {
		const clock = clockOn();
		clock.advance(30);
		expect(clock.skip()).toBe(true);
		expect(clock.seconds).toBe(120);
		expect(clock.extend(60)).toBe(true);
		expect(clock.seconds).toBe(120);
		expect(clock.info.segmentIndex).toBe(1);
		expect(clock.info.targetWatts).toBe(200);
		expect(clock.info.secondsRemainingInSegment).toBe(180);
		expect(clock.total).toBe(360);
		// The block after it starts a minute later.
		expect(clock.segments[2].startSeconds).toBe(300);
	});

	it('adds a whole minute in the workout’s first seconds', () => {
		const clock = clockOn();
		clock.advance(10);
		clock.extend(60);
		expect(clock.seconds).toBe(10);
		expect(clock.info.segmentIndex).toBe(0);
		expect(clock.info.secondsRemainingInSegment).toBe(170);
		expect(clock.info.secondsRemainingTotal).toBe(350);
	});

	it('adds up when pressed twice', () => {
		const clock = clockOn();
		clock.advance(150);
		clock.extend(60);
		clock.extend(60);
		expect(clock.info.segmentIndex).toBe(1);
		expect(clock.info.secondsRemainingInSegment).toBe(210);
		expect(clock.total).toBe(420);
	});

	it('lets Skip land on the next block’s start, a minute later', () => {
		const clock = clockOn();
		clock.advance(130);
		clock.extend(60);
		expect(clock.skip()).toBe(true);
		expect(clock.seconds).toBe(300);
		expect(clock.info.segmentIndex).toBe(2);
		expect(clock.info.secondsIntoSegment).toBe(0);
		expect(clock.info.secondsRemainingInSegment).toBe(60);
	});

	it('lengthens only the block under way, never one already ridden', () => {
		const clock = clockOn();
		clock.advance(30);
		clock.extend(60);
		clock.advance(200); // into block two
		expect(clock.info.segmentIndex).toBe(1);
		clock.extend(60);
		expect(clock.segments.map((s) => s.seconds)).toEqual([180, 180, 60]);
		expect(clock.segments.map((s) => s.startSeconds)).toEqual([0, 180, 360]);
	});

	it('saves the workout as ridden, its blocks where the graph draws them', () => {
		const clock = clockOn();
		expect(clock.workout).toBe(workout);
		clock.advance(130);
		clock.extend(60);
		expect(clock.workout.steps.map((s) => 'seconds' in s && s.seconds)).toEqual(
			[120, 180, 60],
		);
		expect(
			flatten(clock.workout).map((s) => [s.startSeconds, s.seconds]),
		).toEqual(clock.segments.map((s) => [s.startSeconds, s.seconds]));
	});

	it('does nothing past the end', () => {
		const clock = clockOn();
		clock.advance(400);
		expect(clock.info.done).toBe(true);
		expect(clock.extend(60)).toBe(false);
		expect(clock.total).toBe(300);
	});

	it('leaves a road workout’s blocks to their metres (#3499)', () => {
		const clock = createRideClock(workout, 200, {
			bias: () => 1,
			over: () => false,
			road: () => 130,
		});
		expect(clock.extend(60)).toBe(false);
		expect(clock.total).toBe(300);
		expect(clock.info.secondsRemainingInSegment).toBe(110);
	});
});
