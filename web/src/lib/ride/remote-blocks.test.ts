import { describe, expect, it, vi } from 'vitest';
import { openRoad } from '#lib/workout/ridden.ts';
import type { Workout } from '#lib/workout/types.ts';
import { clockActions, pauseOf, type ClockedRide } from './remote-blocks';

const twoBlocks: Workout = {
	name: 'Two blocks',
	steps: [
		{ type: 'steady', seconds: 60, target: 0.6 },
		{ type: 'steady', seconds: 60, target: 0.8 },
	],
};

function ride(over: Partial<ClockedRide> = {}): ClockedRide {
	return {
		state: 'running',
		held: false,
		workout: twoBlocks,
		segments: [{}, {}],
		info: { segmentIndex: 0 },
		road: null,
		pause: vi.fn(),
		resume: vi.fn(),
		skip: vi.fn(),
		extend: vi.fn(),
		...over,
	};
}

describe('Skip and +1 min on the phone (#4425)', () => {
	it.each([
		[
			'a workout mid-block',
			ride(),
			{ pausable: true, paused: false, blocks: true },
		],
		[
			'its last block',
			ride({ info: { segmentIndex: 1 } }),
			{ pausable: true, paused: false, blocks: true, last: true },
		],
		[
			'a road workout, its blocks ending at their metres',
			ride({ road: { pinned: true } }),
			{ pausable: true, paused: false },
		],
		[
			'a road with no workout',
			ride({ workout: openRoad({ routeId: 'r', fromM: 0, toM: 1000 }) }),
			{ pausable: true, paused: false },
		],
		[
			'the count-in',
			ride({ state: 'countdown' }),
			{ pausable: false, paused: false },
		],
		[
			'the summary',
			ride({ state: 'done' }),
			{ pausable: false, paused: false },
		],
		[
			'no workout of your own (a session’s)',
			null,
			{ pausable: false, paused: false },
		],
	])('answers for %s', (_, r, want) => {
		expect(pauseOf(r)).toEqual(want);
	});

	it('skips and stretches a block where the riding screen would', () => {
		const r = ride();
		const act = clockActions(() => r);
		act.skip();
		act.extend();
		expect(r.skip).toHaveBeenCalledOnce();
		expect(r.extend).toHaveBeenCalledWith(60);
	});

	it('does nothing where the riding screen offers nothing', () => {
		const last = ride({ info: { segmentIndex: 1 } });
		clockActions(() => last).skip();
		expect(last.skip).not.toHaveBeenCalled();

		const pinned = ride({ road: { pinned: true } });
		clockActions(() => pinned).skip();
		clockActions(() => pinned).extend();
		expect(pinned.skip).not.toHaveBeenCalled();
		expect(pinned.extend).not.toHaveBeenCalled();

		const counting = ride({ state: 'countdown' });
		clockActions(() => counting).pause();
		expect(counting.pause).not.toHaveBeenCalled();

		expect(() => clockActions(() => null).skip()).not.toThrow();
	});
});
