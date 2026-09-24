import { describe, expect, it } from 'vitest';
import {
	formatClock,
	formatClockLong,
	formatDay,
	formatDuration,
	formatWhen,
	sameDay,
	wkg,
} from './format';

describe('formatDuration', () => {
	it('says minutes under an hour and h mm past it', () => {
		expect(formatDuration(0)).toBe('0 min');
		expect(formatDuration(48 * 60 + 20)).toBe('48 min');
		expect(formatDuration(3600)).toBe('1 h 00');
		expect(formatDuration(9 * 3600 + 40 * 60)).toBe('9 h 40');
		expect(formatDuration(-5)).toBe('0 min');
	});
});

describe('formatClock', () => {
	it('renders m:ss with unbounded minutes (editor round-trip shape)', () => {
		expect(formatClock(0)).toBe('0:00');
		expect(formatClock(75)).toBe('1:15');
		expect(formatClock(5400)).toBe('90:00');
	});
});

describe('formatClockLong', () => {
	it('adds an hours segment past an hour', () => {
		expect(formatClockLong(75)).toBe('1:15');
		expect(formatClockLong(5400)).toBe('1:30:00');
		expect(formatClockLong(-3)).toBe('0:00');
	});
});

describe('formatWhen', () => {
	// The picker's words, said back (#1375): the same clock, three heads.
	it('says Today and Tomorrow, and the weekday beyond', () => {
		const now = new Date(2026, 8, 9, 10, 0).getTime();
		const at = (dayOffset: number) =>
			new Date(2026, 8, 9 + dayOffset, 19, 30).toISOString();
		expect(formatWhen(at(0), true, now)).toMatch(/^Today /);
		expect(formatWhen(at(1), true, now)).toMatch(/^Tomorrow /);
		expect(formatWhen(at(2), true, now)).not.toMatch(/^(Today|Tomorrow)/);
		expect(formatWhen(at(-1), false, now)).not.toMatch(/^(Today|Tomorrow)/);
		// Late tonight is still today, however few hours are left.
		expect(
			formatWhen(new Date(2026, 8, 9, 23, 50).toISOString(), true, now),
		).toMatch(/^Today /);
	});
	it('includes the date only when asked', () => {
		const iso = '2026-08-31T18:30:00Z';
		expect(formatWhen(iso)).not.toBe('');
		expect(formatWhen(iso, true).length).toBeGreaterThan(
			formatWhen(iso).length,
		);
	});
});

describe('formatDay', () => {
	// The chat divider (#2642): a day's first line says which day it was.
	const now = new Date(2026, 8, 24, 0, 30).getTime();
	it('says Today and Yesterday by the calendar, not by 24 hours', () => {
		expect(formatDay(new Date(2026, 8, 24, 0, 5).getTime(), now)).toBe('Today');
		expect(formatDay(new Date(2026, 8, 23, 23, 55).getTime(), now)).toBe(
			'Yesterday',
		);
		expect(formatDay(new Date(2026, 8, 22, 12).getTime(), now)).not.toMatch(
			/^(Today|Yesterday)$/,
		);
	});
	it('names the year only once it is not this one', () => {
		expect(formatDay(new Date(2026, 0, 3).getTime(), now)).not.toMatch(/2026/);
		expect(formatDay(new Date(2025, 11, 30).getTime(), now)).toMatch(/2025/);
	});
	it('groups by local day', () => {
		expect(
			sameDay(
				new Date(2026, 8, 24, 0, 1).getTime(),
				new Date(2026, 8, 24, 23, 59).getTime(),
			),
		).toBe(true);
		expect(
			sameDay(
				new Date(2026, 8, 23, 23, 59).getTime(),
				new Date(2026, 8, 24, 0, 1).getTime(),
			),
		).toBe(false);
	});
});

describe('wkg', () => {
	it('guards missing or zero weight', () => {
		expect(wkg(250, 80)).toBe('3.1');
		expect(wkg(250, 0)).toBe('–');
		expect(wkg(250, null)).toBe('–');
		expect(wkg(250, undefined)).toBe('–');
	});
});
