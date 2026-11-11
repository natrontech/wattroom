import { describe, expect, it } from 'vitest';
import {
	UnrankedDefaultFtp,
	UnrankedDefaultWeight,
	UnrankedFreshWeight,
	UnrankedLate,
	UnrankedUnconfirmedWeight,
	UnrankedUntimeable,
	type RaceBracket,
} from '#lib/protocol.ts';
import { finishMark, unrankedWhy, yoursFirst } from './closing-card';

describe('an unranked rider told why (#3779)', () => {
	const reasons = [
		[UnrankedDefaultFtp, { href: '/settings/profile', label: 'Set your FTP' }],
		[
			UnrankedDefaultWeight,
			{ href: '/settings/profile', label: 'Set your weight' },
		],
		[UnrankedFreshWeight, undefined],
		[UnrankedUnconfirmedWeight, 'confirm'],
		[UnrankedUntimeable, undefined],
		[UnrankedLate, undefined],
	] as const;

	it.each(reasons)('%s has its own sentence and way back', (why, way) => {
		const told = unrankedWhy(why);
		expect(told.text).toMatch(/^[A-Z].*\.$/);
		expect(told.text).not.toMatch(/undefined|NaN/);
		expect(told.way).toEqual(way);
	});

	it('says each reason differently', () => {
		const texts = reasons.map(([why]) => unrankedWhy(why).text);
		expect(new Set(texts).size).toBe(texts.length);
	});

	it('names the windows the hub holds a weight to', () => {
		expect(unrankedWhy(UnrankedFreshWeight).text).toContain('14 days');
		expect(unrankedWhy(UnrankedUnconfirmedWeight).text).toContain('90 days');
	});
});

describe('the results per Category', () => {
	const results: RaceBracket[] = [
		{ category: 'D', placed: [{ riderId: 'ana', name: 'Ana', m: 1000 }] },
		{
			category: 'C',
			unranked: [{ riderId: 'ben', name: 'Ben', m: 900 }],
			alone: true,
		},
		{ category: 'B', placed: [{ riderId: 'cy', name: 'Cy', m: 1000 }] },
	];

	it('puts your Category first, the rest in D–A order', () => {
		expect(yoursFirst(results, 'cy').map((b) => b.category)).toEqual([
			'B',
			'D',
			'C',
		]);
		expect(yoursFirst(results, 'ben').map((b) => b.category)).toEqual([
			'C',
			'D',
			'B',
		]);
	});

	it('keeps the order for a rider not on the card', () => {
		expect(yoursFirst(results, 'zed')).toEqual(results);
	});
});

describe('a finisher’s mark', () => {
	it.each([
		[{ ms: 83_456, m: 1200 }, '1:23.4'],
		[{ ms: 3_725_000, m: 1200 }, '62:05.0'],
		// A clock race ranks on distance: no time, the metres.
		[{ m: 8_765 }, '8.77 km'],
	])('%o reads %s', (f, want) => {
		expect(finishMark({ riderId: 'x', name: 'X', ...f })).toBe(want);
	});
});
