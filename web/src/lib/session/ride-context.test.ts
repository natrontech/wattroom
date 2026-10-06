import { describe, expect, it } from 'vitest';
import { rideContext } from './ride-context';

describe('rideContext', () => {
	it('names the mode and the workout for a solo ride', () => {
		expect(rideContext('Solo', 'Smoke Test')).toBe('Solo · Smoke Test');
	});

	it('counts the riders once there is more than one', () => {
		expect(rideContext('Session', 'Sweet Spot', 3)).toBe(
			'Session · Sweet Spot · 3 riders',
		);
		expect(rideContext('Session', 'Sweet Spot', 1)).toBe(
			'Session · Sweet Spot',
		);
	});

	it('drops a name that is not there yet instead of a dangling dot', () => {
		expect(rideContext('Session', '', 2)).toBe('Session · 2 riders');
	});
});
