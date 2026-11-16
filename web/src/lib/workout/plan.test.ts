import { describe, expect, it } from 'vitest';

import { dayLabel, localDay, weekFrom } from './plan.svelte.ts';

// A plan is the rider's own date (#4615): late evening must not roll into
// tomorrow the way an ISO string in UTC would, and the week walks month ends.
describe('the plan’s days', () => {
	it('names the local date, not the UTC one', () => {
		expect(localDay(new Date(2026, 10, 16, 23, 30))).toBe('2026-11-16');
	});

	it('walks seven days across a month end, today first', () => {
		expect(weekFrom(new Date(2026, 10, 28, 8))).toEqual([
			'2026-11-28',
			'2026-11-29',
			'2026-11-30',
			'2026-12-01',
			'2026-12-02',
			'2026-12-03',
			'2026-12-04',
		]);
	});

	it('says today and tomorrow, then the weekday and date', () => {
		const now = new Date(2026, 10, 16, 8);
		expect(dayLabel('2026-11-16', now)).toBe('Today');
		expect(dayLabel('2026-11-17', now)).toBe('Tomorrow');
		expect(dayLabel('2026-11-19', now)).toMatch(/19$/);
	});
});
