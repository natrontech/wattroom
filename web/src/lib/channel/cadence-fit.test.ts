import { describe, expect, it } from 'vitest';
import { fitsCadence } from './cadence-fit';

describe('fitsCadence (#1431)', () => {
	it('matches within 5 % of the cadence, or of double it', () => {
		expect(fitsCadence(90, 90)).toBe(true);
		expect(fitsCadence(94, 90)).toBe(true);
		expect(fitsCadence(95, 90)).toBe(false);
		expect(fitsCadence(180, 90)).toBe(true);
		expect(fitsCadence(165, 85)).toBe(true);
		expect(fitsCadence(128, 90)).toBe(false);
	});

	it('says nothing for an untagged track or an idle deck', () => {
		expect(fitsCadence(undefined, 90)).toBe(false);
		expect(fitsCadence(0, 90)).toBe(false);
		expect(fitsCadence(90, undefined)).toBe(false);
		expect(fitsCadence(90, 0)).toBe(false);
	});
});
