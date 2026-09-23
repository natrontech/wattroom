import { describe, expect, it } from 'vitest';
import { weekTotals } from './week';

const DAY = 24 * 3600 * 1000;
const now = Date.parse('2026-09-23T12:00:00Z');
const ride = (daysAgo: number, seconds: number, kj: number) => ({
	startedAt: new Date(now - daysAgo * DAY).toISOString(),
	seconds,
	kj,
});

describe('weekTotals', () => {
	it('sums the last seven days and leaves the rest out', () => {
		expect(
			weekTotals(
				[ride(1, 1800, 300), ride(6.5, 3600, 500), ride(8, 600, 90)],
				now,
			),
		).toEqual({ count: 2, minutes: 90, kj: 800 });
	});

	it('is zero with no rides', () => {
		expect(weekTotals([], now)).toEqual({ count: 0, minutes: 0, kj: 0 });
	});
});
