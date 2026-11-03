import { describe, expect, it } from 'vitest';
import { answerLine, remoteLine } from './remote-line';

describe('the phone remote’s line (#4253)', () => {
	it.each([
		['no answer yet', null, null, null],
		['flat', { page: 'power', world: false }, null, 'POWER · Flat'],
		[
			'3D with its camera',
			{ page: 'ride', world: true, camera: 'heli' },
			null,
			'RIDE · 3D · Overhead',
		],
		[
			'a camera off 3D is not said',
			{ page: 'ride', world: false, camera: 'side' },
			null,
			'RIDE · Flat',
		],
		[
			'Photo pressed, not taken yet',
			{ page: 'ride', world: true, camera: 'chase', pictures: 1 },
			1,
			'RIDE · 3D · Chase',
		],
		[
			'Photo taken',
			{ page: 'ride', world: true, camera: 'chase', pictures: 2 },
			1,
			'Picture taken',
		],
		[
			'the first picture of the ride',
			{ page: 'ride', world: true, pictures: 1 },
			0,
			'Picture taken',
		],
	])('%s', (_, view, photoFrom, want) => {
		expect(remoteLine(view, photoFrom)).toBe(want);
	});
});

describe('the answer on the phone’s Easier / Harder (#3334)', () => {
	it.each([
		['a blind gear is named', '0', false, 'Gear 0'],
		['a blind gear up', '+2', false, 'Gear +2'],
		['a blind gear down', '−3', false, 'Gear −3'],
		['a table gear at its end', 'Gear 24', true, 'Gear 24 · end'],
		['the bias says what it is', 'Bias 103%', false, 'Bias 103%'],
		['the watts at their end', '1000 W', true, '1000 W · end'],
	])('%s', (_, label, atEnd, want) => {
		expect(answerLine({ label, atEnd })).toBe(want);
	});
});
