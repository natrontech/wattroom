import { describe, expect, it } from 'vitest';
import { screenShareChanges } from './screen-shares';

describe('screenShareChanges (#664)', () => {
	it('names who started and who stopped', () => {
		expect(
			screenShareChanges(new Set(['ada']), new Set(['kim']), 'me'),
		).toEqual([
			{ rider: 'kim', live: true },
			{ rider: 'ada', live: false },
		]);
	});

	it('says nothing when nothing changed', () => {
		expect(
			screenShareChanges(new Set(['ada']), new Set(['ada']), 'me'),
		).toEqual([]);
	});

	it('leaves your own share to the notice above the page', () => {
		expect(screenShareChanges(new Set(), new Set(['me']), 'me')).toEqual([]);
		expect(screenShareChanges(new Set(['me']), new Set(), 'me')).toEqual([]);
	});
});
