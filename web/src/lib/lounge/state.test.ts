import { describe, expect, it } from 'vitest';
import { nextWeather, weatherOf } from '$lib/lounge/state';

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
