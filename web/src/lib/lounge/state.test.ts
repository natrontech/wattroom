import { describe, expect, it } from 'vitest';
import {
	nextRadioPick,
	nextWeather,
	radioPickOf,
	stationPick,
	weatherOf,
} from '$lib/lounge/state';

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

	it('steps from records through the mix and each style, and back', () => {
		const seen = ['' as const, nextRadioPick('')];
		while (seen.length < 6) seen.push(nextRadioPick(seen[seen.length - 1]));
		expect(seen).toEqual(['', 'mix', 'lofi', 'chip', 'ambient', '']);
	});

	it('gives the generated station the mix for records and mix', () => {
		expect(stationPick('')).toBe('');
		expect(stationPick('mix')).toBe('');
		expect(stationPick('chip')).toBe('chip');
	});
});
