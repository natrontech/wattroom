import { describe, expect, it } from 'vitest';
import { drawsTheRide } from './ride-screens';

describe('drawsTheRide', () => {
	it.each([
		['/ride', true],
		['/crew/c1/v/v1/training', true],
		['/crew/c1/v/v1', false],
		['/crew/c1/c/t1', false],
		['/crew/c1/s/s1', false],
		['/crew/c1', false],
		['/ramp', true],
		['/ride/x', false],
		['/home', false],
	])('%s → %s', (path, draws) => {
		expect(drawsTheRide(path)).toBe(draws);
	});
});
