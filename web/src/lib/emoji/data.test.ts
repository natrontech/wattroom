import { describe, expect, it } from 'vitest';
import { groupEmoji, searchEmoji } from './data';

const groups = groupEmoji([
	{
		unicode: '😂',
		label: 'face with tears of joy',
		group: 0,
		order: 2,
		tags: ['lol', 'laugh'],
	},
	{ unicode: '😀', label: 'grinning face', group: 0, order: 1, tags: ['grin'] },
	{
		unicode: '👍',
		label: 'thumbs up',
		group: 1,
		order: 5,
		tags: ['+1', 'yes'],
	},
	{ unicode: '🏻', label: 'light skin tone', group: 2, order: 9 },
	{ unicode: '🇦', label: 'regional indicator A' },
]);

describe('groupEmoji', () => {
	it('orders a group by the data, and drops swatches and letters', () => {
		expect(groups[0].emoji.map((e) => e.unicode)).toEqual(['😀', '😂']);
		const all = groups.flatMap((g) => g.emoji.map((e) => e.unicode));
		expect(all).not.toContain('🏻');
		expect(all).not.toContain('🇦');
	});
});

describe('searchEmoji', () => {
	it('matches every word as a prefix of the label', () => {
		expect(searchEmoji(groups, 'thumb up').map((e) => e.unicode)).toEqual([
			'👍',
		]);
	});
	it('falls back to tags, after label matches', () => {
		expect(searchEmoji(groups, 'lol').map((e) => e.unicode)).toEqual(['😂']);
		expect(searchEmoji(groups, 'g').map((e) => e.unicode)).toEqual(['😀']);
	});
	it('finds nothing for an empty query', () => {
		expect(searchEmoji(groups, '  ')).toEqual([]);
	});
});
