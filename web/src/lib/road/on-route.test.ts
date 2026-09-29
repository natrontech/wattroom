import { describe, expect, it } from 'vitest';
import { flatten, targetAt } from '$lib/workout/engine';
import type { Workout } from '$lib/workout/types';
import { validateWorkout } from '$lib/workout/validate';
import { onRoute } from './compile';
import type { Road } from './road';

const sweetSpot: Workout = {
	name: 'Sweet spot',
	steps: [
		{ type: 'ramp', seconds: 300, from: 0.5, to: 0.8 },
		{ type: 'steady', seconds: 600, target: 0.9 },
		{ type: 'steady', seconds: 120, target: 0.55 },
	],
};

const road: Road = {
	length: 6000,
	heights: Array.from({ length: 301 }, (_, i) => 500 + i * 0.4),
	turns: new Array(300).fill(0),
};

describe('onRoute — any workout on a route (#3100)', () => {
	it('carries the road by reference, with no block pinned to it', () => {
		const onIt = onRoute(sweetSpot, { id: 'route-1', road }, 1000);
		expect(onIt.road).toEqual({ routeId: 'route-1', fromM: 1000, toM: 6000 });
		expect(onIt.steps).toBe(sweetSpot.steps);
		expect(validateWorkout(onIt).ok).toBe(true);
	});

	// The browser scores each second against the engine's target, so the
	// targets are the score: the same, second by second, on a road or off it.
	it('leaves every second’s target as it was', () => {
		const off = flatten(sweetSpot);
		const on = flatten(onRoute(sweetSpot, { id: 'route-1', road }));
		expect(on).toEqual(off);
		for (let t = 0; t < 1020; t += 7)
			expect(targetAt(on, 250, t).targetWatts).toBe(
				targetAt(off, 250, t).targetWatts,
			);
	});

	it('keeps the start on the road', () => {
		const late = onRoute(sweetSpot, { id: 'route-1', road }, 9000).road!;
		expect(late.fromM).toBeLessThan(late.toM);
		expect(onRoute(sweetSpot, { id: 'route-1', road }, -5).road!.fromM).toBe(0);
	});
});
