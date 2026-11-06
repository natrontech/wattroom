import { describe, expect, it } from 'vitest';
import { cardLabel } from './card';

describe('the ride card’s button (#3142, #4430)', () => {
	it('offers a free ride on a road its poster, and any other ride its card', () => {
		expect(cardLabel({ distanceM: 12000, rideMode: 'free' })).toBe(
			'Download the poster',
		);
		expect(cardLabel({})).toBe('Download the ride card');
		expect(cardLabel({ rideMode: 'workout' })).toBe('Download the ride card');
	});

	it('offers a workout on a road its card: the workout comes first', () => {
		expect(cardLabel({ distanceM: 12000, rideMode: 'workout' })).toBe(
			'Download the ride card',
		);
	});

	it('keeps the poster for a road ride saved before rides kept their mode', () => {
		expect(cardLabel({ distanceM: 12000 })).toBe('Download the poster');
	});
});
