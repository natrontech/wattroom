import { describe, expect, it } from 'vitest';
import { CHEER_BACK_MS, createCheerBack } from './cheer-back';

describe('createCheerBack', () => {
	it.each([
		['nobody cheered', [], 0, ''],
		[
			'a cheer for you',
			[{ emoji: 'flame', fromId: 'mia', to: 'jan' }],
			1000,
			'mia',
		],
		['a cheer for everyone', [{ emoji: 'flame', fromId: 'kim' }], 1000, 'kim'],
		[
			'a cheer for someone else',
			[{ emoji: 'flame', fromId: 'kim', to: 'mia' }],
			1000,
			'',
		],
		['your own cheer', [{ emoji: 'flame', fromId: 'jan' }], 1000, ''],
		['a cheer with no sender', [{ emoji: 'flame' }], 1000, ''],
		[
			'a cheer past the minute',
			[{ emoji: 'flame', fromId: 'mia' }],
			CHEER_BACK_MS + 1,
			'',
		],
	])('%s', (_, cheers, later, want) => {
		const back = createCheerBack(() => 'jan');
		back.heard(cheers, 0);
		expect(back.to(later)).toBe(want);
	});

	it('answers the last of several', () => {
		const back = createCheerBack(() => 'jan');
		back.heard([{ emoji: 'flame', fromId: 'mia' }], 0);
		back.heard([{ emoji: 'flame', fromId: 'kim', to: 'jan' }], 500);
		expect(back.to(1000)).toBe('kim');
	});
});
