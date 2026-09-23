import { describe, expect, it } from 'vitest';
import type { SessionRecap } from '$lib/protocol';
import { riddenTogether, riddenTotals, workoutByName } from './crew-workouts';

const recap = (
	workout: string,
	endedAt: number,
	riders: SessionRecap['riders'] = [],
): SessionRecap => ({
	id: `${workout}-${endedAt}`,
	workout,
	startedAt: endedAt - 3_600_000,
	endedAt,
	riders,
});
const rider = (id: string, name: string, rode = true) => ({
	id,
	rider: name,
	from: 0,
	to: 0,
	rode,
});

describe('riddenTogether', () => {
	it('folds the recaps by workout, the most recently ridden first', () => {
		const ridden = riddenTogether([
			recap('Sweet Spot', 100),
			recap('Over-Unders', 300),
			recap('Sweet Spot', 200),
		]);
		expect(
			ridden.map(({ name, times, lastAt }) => ({ name, times, lastAt })),
		).toEqual([
			{ name: 'Over-Unders', times: 1, lastAt: 300 },
			{ name: 'Sweet Spot', times: 2, lastAt: 200 },
		]);
		// Its sessions, newest first, and their hours summed.
		expect(ridden[1].recaps.map((r) => r.endedAt)).toEqual([200, 100]);
		expect(ridden[1].seconds).toBe(7200);
	});

	it('leaves out a session that rode no named workout', () => {
		expect(riddenTogether([recap('  ', 100)])).toEqual([]);
	});

	// #2583: who rode it, and how many of them were yours.
	it('names who rode it, most sessions first, and counts yours', () => {
		const [ridden] = riddenTogether(
			[
				recap('Openers', 100, [rider('a', 'Mara'), rider('me', 'Jan')]),
				recap('Openers', 200, [
					rider('b', 'Sven'),
					rider('b', 'Sven'),
					rider('me', 'Jan'),
					rider('c', 'Sofa', false),
				]),
			],
			'me',
		);
		// You are counted, not listed: the card says "you 2×" once.
		expect(ridden.riders).toEqual(['Mara', 'Sven']);
		expect(ridden.yours).toBe(2);
	});

	// A display name is nobody's key: two Alexes are two riders.
	it('keeps two riders with one name apart', () => {
		const [ridden] = riddenTogether([
			recap('Openers', 100, [rider('a1', 'Alex'), rider('a2', 'Alex')]),
		]);
		expect(ridden.riders).toEqual(['Alex', 'Alex']);
	});

	it('adds the tiles up', () => {
		const ridden = riddenTogether(
			[recap('A', 100, [rider('me', 'Jan')]), recap('B', 200), recap('A', 300)],
			'me',
		);
		expect(riddenTotals(ridden)).toEqual({
			sessions: 3,
			workouts: 2,
			seconds: 3 * 3600,
			yours: 1,
		});
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
