import { describe, expect, it } from 'vitest';
import {
	formatClock,
	formatClockLong,
	formatDuration,
	formatWhen,
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
