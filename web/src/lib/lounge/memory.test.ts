import { describe, expect, it } from 'vitest';
import {
	plantStage,
	initialsOf,
	recordsOf,
	wearStage,
} from '$lib/lounge/memory';

describe('what the room remembers', () => {
	it('grows the plant with the sessions ridden together', () => {
		expect([0, 1, 4, 5, 19, 20, 50, 900].map(plantStage)).toEqual([
			0, 1, 1, 2, 2, 3, 4, 4,
		]);
	});
});

describe('the arcade and time together on the room', () => {
	it('gives the cabinet three letters it can draw', () => {
		expect(initialsOf('Jan Lauber')).toBe('JAN');
		expect(initialsOf('Zoë')).toBe('ZOE');
		expect(initialsOf('19boboy97')).toBe('BOB');
		expect(initialsOf('李')).toBe('');
	});

	it('crowns each game’s record holder once, and skips an empty board', () => {
		const entry = (id: string, score: number) => ({ id, name: id, score });
		const board = (top: ReturnType<typeof entry>[]) => ({
			top,
			today: [],
			best: 0,
		});
		const { records, crowns } = recordsOf(
			{
				day: '2026-11-07',
				seed: 1,
				cup: [],
				games: {
					bergpreis: board([entry('ann', 900), entry('bob', 500)]),
					feedzone: board([entry('ann', 400)]),
					darts: board([]),
				},
			},
			['bergpreis', 'feedzone', 'darts'],
		);
		expect(records.map((r) => r.score)).toEqual([900, 400]);
		expect(crowns).toEqual(['ann']);
	});

	it('wears the room in at 5, 20 and 50 hours together', () => {
		const h = 3600;
		expect([0, 5 * h - 1, 5 * h, 20 * h, 50 * h].map(wearStage)).toEqual([
			0, 0, 1, 2, 3,
		]);
	});
});
