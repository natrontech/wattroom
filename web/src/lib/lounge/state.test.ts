import { describe, expect, it } from 'vitest';
import {
	moodOf,
	nextWeather,
	radioPickOf,
	skipShift,
	stationPick,
	weatherOf,
} from '#lib/lounge/state.ts';
import { recordAt } from '#lib/lounge/records.ts';
import { SLOT_SEC } from '#lib/lounge/station.ts';

describe('lounge weather', () => {
	it('is rain until someone changes it', () => {
		expect(weatherOf(undefined)).toBe('rain');
		expect(weatherOf({})).toBe('rain');
	});

	it('draws a word it does not know as rain', () => {
		expect(weatherOf({ weather: 'hail' })).toBe('rain');
	});

	it('steps through every weather and back', () => {
		expect(nextWeather('rain')).toBe('clear');
		expect(nextWeather('clear')).toBe('snow');
		expect(nextWeather('snow')).toBe('rain');
	});
});

describe('house radio pick', () => {
	it('plays records until someone changes it, and for a word it does not know', () => {
		expect(radioPickOf(undefined)).toBe('');
		expect(radioPickOf({ radioStyle: 'polka' })).toBe('');
	});

	it('gives the generated station the mix for records and mix', () => {
		expect(stationPick('')).toBe('');
		expect(stationPick('mix')).toBe('');
		expect(stationPick('chip')).toBe('chip');
	});
});

describe('house radio next track', () => {
	const now = 1_793_000_000_000;

	it('starts the next record from its top a second after the click', () => {
		let shift = 0;
		const first = recordAt('crew', now / 1000).record;
		for (let skip = 0; skip < 5; skip++) {
			const next = skipShift('crew', '', shift, now);
			expect(next).toBeGreaterThan(shift);
			const landed = recordAt('crew', (now + 1000 + next) / 1000 + 0.001);
			expect(landed.at).toBeLessThan(0.01);
			if (skip === 0) expect(landed.record).not.toBe(first);
			shift = next;
		}
	});

	it('starts the next generated tune on its first bar, in any style', () => {
		for (const pick of ['mix', 'lofi', 'chip', 'ambient'] as const) {
			const shift = skipShift('crew', pick, 4321, now);
			expect(shift).toBeGreaterThan(4321);
			const radio = (now + 1000 + shift) / 1000;
			expect(
				Math.abs(radio / SLOT_SEC - Math.round(radio / SLOT_SEC)),
			).toBeLessThan(1e-6);
		}
	});

	it('never lands on the tune it skips, a hair before its end', () => {
		const end = SLOT_SEC * 1000 * 12_000_000;
		const shift = skipShift('crew', 'lofi', 0, end - 1500);
		expect(Math.floor((end - 500 + shift) / 1000 / SLOT_SEC)).toBeGreaterThan(
			Math.floor((end - 1500) / 1000 / SLOT_SEC),
		);
	});
});

describe('lounge mood', () => {
	it('is none until picked, and for a word it does not know', () => {
		expect(moodOf(undefined)).toBe('');
		expect(moodOf({ mood: 'disco' })).toBe('');
		expect(moodOf({ mood: 'snow' })).toBe('snow');
	});
});
