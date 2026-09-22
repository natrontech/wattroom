import { describe, expect, it } from 'vitest';
import type { SessionRecap } from '$lib/protocol';
import { riddenTogether, workoutByName } from './crew-workouts';

const recap = (workout: string, endedAt: number): SessionRecap => ({
	id: `${workout}-${endedAt}`,
	workout,
	startedAt: endedAt - 3_600_000,
	endedAt,
	riders: [],
});

describe('riddenTogether', () => {
	it('folds the recaps by workout, the most recently ridden first', () => {
		expect(
			riddenTogether([
				recap('Sweet Spot', 100),
				recap('Over-Unders', 300),
				recap('Sweet Spot', 200),
			]),
		).toEqual([
			{ name: 'Over-Unders', times: 1, lastAt: 300 },
			{ name: 'Sweet Spot', times: 2, lastAt: 200 },
		]);
	});

	it('leaves out a session that rode no named workout', () => {
		expect(riddenTogether([recap('  ', 100)])).toEqual([]);
	});
});

describe('workoutByName', () => {
	const sources = [
		{ name: 'Sweet Spot', json: '{"from":"schedule"}' },
		{ name: 'Sweet Spot', json: '{"from":"shelf"}' },
	];

	it('takes the first source that holds the name', () => {
		expect(workoutByName('Sweet Spot', sources)).toBe('{"from":"schedule"}');
	});

	it('is null when no source does — the coach built it, and it is theirs', () => {
		expect(workoutByName('Their Own Thing', sources)).toBeNull();
	});
});
