import { describe, expect, it } from 'vitest';
import { comingsAndGoings } from '$lib/room/comings-and-goings';

const set = (...ids: string[]) => new Set(ids);

describe('comingsAndGoings', () => {
	it('reports arrivals and departures in one pass', () => {
		expect(comingsAndGoings(set('ada'), set('kim'), 'me')).toEqual([
			{ rider: 'kim', live: true },
			{ rider: 'ada', live: false },
		]);
	});

	it('says nothing about a set that did not move', () => {
		expect(comingsAndGoings(set('ada'), set('ada'), 'me')).toEqual([]);
	});

	it('never reports you to yourself — you know what you just did', () => {
		expect(comingsAndGoings(set(), set('me'), 'me')).toEqual([]);
		expect(comingsAndGoings(set('me'), set(), 'me')).toEqual([]);
	});

	it('still reports everyone else when you are in both sets', () => {
		expect(comingsAndGoings(set('me'), set('me', 'ada'), 'me')).toEqual([
			{ rider: 'ada', live: true },
		]);
	});
});
