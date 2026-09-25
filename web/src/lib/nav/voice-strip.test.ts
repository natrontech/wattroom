import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STRIP_MAX, orderBySpoke } from './voice-strip';

const riders = [
	{ id: 'c', name: 'Cleo' },
	{ id: 'a', name: 'Ana' },
	{ id: 'b', name: 'Bo' },
	{ id: 'd', name: 'Dov' },
];

describe('orderBySpoke', () => {
	it('puts the most recent speaker first, the quiet last by name', () => {
		const lastSpoke = new Map([
			['b', 100],
			['d', 300],
		]);
		expect(orderBySpoke(riders, lastSpoke).map((r) => r.id)).toEqual([
			'd',
			'b',
			'a',
			'c',
		]);
	});

	it('holds still by name while nobody has spoken', () => {
		expect(orderBySpoke(riders, new Map()).map((r) => r.name)).toEqual([
			'Ana',
			'Bo',
			'Cleo',
			'Dov',
		]);
	});

	it('leaves the roster it was given alone', () => {
		const before = riders.map((r) => r.id);
		orderBySpoke(riders, new Map([['a', 1]]));
		expect(riders.map((r) => r.id)).toEqual(before);
	});

	it('fits a two-by-two grid', () => {
		expect(STRIP_MAX).toBe(4);
	});
});

// The strip's contract: the channel's own pages already show everyone, so it
// stays off them (#2852). It hid on the Lounge's path alone and drew on
// Training and the session's page, a fourth copy of riders the crew strip
// and the people column already show.
describe('where the voice strip stays off', () => {
	it('asks the connection whether this is one of the channel’s own pages', () => {
		const source = readFileSync(
			join(import.meta.dirname, 'VoiceStrip.svelte'),
			'utf8',
		);
		expect(source).toMatch(/channelConnection\.onPlacePath\(pathname\)/);
		expect(source).not.toMatch(/pathname === conn\.address\.home/);
	});
});
