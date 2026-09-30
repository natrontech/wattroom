import { describe, expect, it } from 'vitest';
import { cardLabel } from './card';

describe('the ride card’s button (#3142)', () => {
	it('offers a road ride its poster, and any other ride its card', () => {
		expect(cardLabel({ distanceM: 12000 })).toBe('Download the poster');
		expect(cardLabel({})).toBe('Ride card');
	});
});
