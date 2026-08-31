import { describe, expect, it } from 'vitest';
import { formatClock, formatClockLong, formatWhen, wkg } from './format';

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
	it('includes the date only when asked', () => {
		const iso = '2026-08-31T18:30:00Z';
		expect(formatWhen(iso)).not.toBe('');
		expect(formatWhen(iso, true).length).toBeGreaterThan(
			formatWhen(iso).length,
		);
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
