import { describe, expect, it } from 'vitest';
import { dockShows, drawsTheRide } from './ride-screens';

describe('drawsTheRide', () => {
	it.each([
		['/ride', true],
		['/crew/c1/v/v1/training', true],
		['/crew/c1/v/v1', false],
		['/crew/c1/c/t1', false],
		['/crew/c1/s/s1', false],
		['/crew/c1', false],
		['/ramp', false],
		['/ride/x', false],
		['/home', false],
	])('%s → %s', (path, draws) => {
		expect(drawsTheRide(path)).toBe(draws);
	});
});

describe('dockShows', () => {
	it.each([
		[false, '/home', false],
		[false, '/crew/c1/c/t1', false],
		[false, '/ride', false],
		[true, '/home', true],
		[true, '/crew/c1/c/t1', true],
		[true, '/crew/c1/v/v1', true],
		[true, '/ride', false],
		[true, '/crew/c1/v/v1/training', false],
	])('a ride live %s, on %s → %s', (live, path, shows) => {
		expect(dockShows(live, path)).toBe(shows);
	});
});
