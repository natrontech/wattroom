import { describe, expect, it } from 'vitest';
import { bestFive, follow, SPRINT, target } from './sprint';

describe('the sprint toy', () => {
	it('turns taps in the last second into watts, capped', () => {
		expect(target([100, 500, 900], 1000, null)).toBe(3 * SPRINT.perTap);
		expect(target([0], 1500, null)).toBe(0); // a tap older than a second is spent
		const mash = Array.from({ length: 40 }, (_, i) => 1000 + i * 20);
		expect(target(mash, 1800, null)).toBe(SPRINT.max);
	});

	// The no-mash way to play: a press held past the threshold is worth a
	// steady effort, and a quick tap is not a hold.
	it('lets a held press stand in for mashing', () => {
		expect(target([], 1000, 1000 - SPRINT.holdAfter)).toBe(SPRINT.hold);
		expect(target([], 1000, 1000 - SPRINT.holdAfter + 1)).toBe(0);
	});

	it('follows the target like a flywheel, never past it', () => {
		const once = follow(0, 1000, SPRINT.tau);
		expect(once).toBeGreaterThan(600);
		expect(once).toBeLessThan(1000);
		expect(follow(once, 1000, 10_000)).toBeCloseTo(1000, 0);
	});

	it('scores the best five seconds, not the average of the run', () => {
		const per = 5000 / SPRINT.sampleEvery;
		const run = [...Array(per).fill(200), ...Array(per).fill(1000)];
		expect(bestFive(run)).toBe(1000);
		expect(bestFive([])).toBe(0);
		// A run shorter than five seconds is averaged over five: stopping early
		// cannot inflate the score.
		expect(bestFive(Array(per / 2).fill(1000))).toBe(500);
	});
});
