import { describe, expect, it } from 'vitest';
import { xpForLevel } from '$lib/level';
import { cheerWords, cheersOf, type SeenStanding } from '$lib/lounge/standing';

describe('cheersOf', () => {
	it('never celebrates a rider the room sees for the first time', () => {
		const seen: SeenStanding = new Map();
		expect(
			cheersOf(seen, [{ id: 'kim', totalXp: xpForLevel(12), streakWeeks: 4 }]),
		).toEqual([]);
		expect(seen.get('kim')).toEqual({ level: 12, streak: 4 });
	});

	it('celebrates a level gained and a week added, once each', () => {
		const seen: SeenStanding = new Map();
		const kim = { id: 'kim', totalXp: xpForLevel(12) - 10, streakWeeks: 2 };
		const lena = { id: 'lena', totalXp: 300, streakWeeks: 0 };
		cheersOf(seen, [kim, lena]);

		// Kim's ride saves: she crosses into level 12 and rides a third week.
		const after = { ...kim, totalXp: xpForLevel(12) + 40, streakWeeks: 3 };
		expect(cheersOf(seen, [after, lena])).toEqual([
			{ id: 'kim', level: 12, streak: 3 },
		]);
		// The next tick carries the same numbers: nothing more.
		expect(cheersOf(seen, [after, lena])).toEqual([]);

		// Lena starts a streak without a level.
		expect(
			cheersOf(seen, [after, { ...lena, totalXp: 400, streakWeeks: 1 }]),
		).toEqual([{ id: 'lena', streak: 1 }]);
	});

	it('remembers a rider who leaves and comes back, and a streak that lapsed', () => {
		const seen: SeenStanding = new Map();
		cheersOf(seen, [{ id: 'kim', totalXp: 100, streakWeeks: 5 }]);
		cheersOf(seen, []);
		// Back after a week off: the streak restarted and is lower. Quiet.
		expect(
			cheersOf(seen, [{ id: 'kim', totalXp: 200, streakWeeks: 1 }]),
		).toEqual([]);
		// The next week's ride extends the new one.
		expect(
			cheersOf(seen, [{ id: 'kim', totalXp: 300, streakWeeks: 2 }]),
		).toEqual([{ id: 'kim', streak: 2 }]);
	});

	it('skips a roster with no XP on it', () => {
		const seen: SeenStanding = new Map();
		expect(cheersOf(seen, [{ id: 'kim' }])).toEqual([]);
		expect(seen.size).toBe(0);
	});
});

describe('cheerWords', () => {
	it('says what grew', () => {
		expect(cheerWords({ id: 'k', level: 12 })).toBe('Level 12');
		expect(cheerWords({ id: 'k', streak: 3 })).toBe('3 weeks in a row');
		expect(cheerWords({ id: 'k', streak: 1 })).toBe('A streak begins');
		expect(cheerWords({ id: 'k', level: 4, streak: 2 })).toBe(
			'Level 4 · 2 weeks in a row',
		);
	});
});
