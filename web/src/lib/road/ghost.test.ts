import { describe, expect, it } from 'vitest';
import {
	formatSplit,
	gapWords,
	ghostLabel,
	ghostMetreAt,
	ghostSecondsTo,
	splitAt,
} from './ghost';

// Your ghost rode 5 m a second from the start (#3033).
const ghost = Array.from({ length: 601 }, (_, t) => 5 * t);

describe('racing your ghost (#3033)', () => {
	it('knows when the ghost passed a metre, between its seconds', () => {
		expect(ghostSecondsTo(ghost, 1000)).toBe(200);
		expect(ghostSecondsTo(ghost, 1002.5)).toBeCloseTo(200.5, 10);
		expect(ghostSecondsTo(ghost, 5000)).toBeNull();
	});

	it('splits negative when you are ahead, positive when behind', () => {
		// At halfway, 1.5 km: the ghost took 300 s.
		expect(splitAt(ghost, 1500, 288)).toBe(-12);
		expect(splitAt(ghost, 1500, 308)).toBe(8);
		expect(splitAt(ghost, 4000, 700)).toBeNull();
	});

	it('reads as the riding surface says it', () => {
		expect(formatSplit(-12)).toBe('−0:12');
		expect(formatSplit(8.4)).toBe('+0:08');
		expect(formatSplit(-75)).toBe('−1:15');
		// Level is level: neither ahead nor behind, so no sign (#3174).
		expect(formatSplit(0)).toBe('0:00');
		expect(formatSplit(-0.3)).toBe('0:00');
		expect(formatSplit(0.4)).toBe('0:00');
	});
});

describe('the gap in words (#3246)', () => {
	// A synthetic ride against the 5 m/s line, at three metres.
	it.each([
		[500, 88, { value: '12', unit: 's ahead' }],
		[1500, 308, { value: '8', unit: 's behind' }],
		[2500, 575, { value: '1:15', unit: 'behind' }],
	])('at %i m after %i s reads %o', (m, seconds, words) => {
		expect(gapWords(splitAt(ghost, m, seconds)!)).toEqual(words);
	});

	it('says level, not a sign, within half a second', () => {
		expect(gapWords(0.4)).toEqual({ value: 'level', unit: '' });
		expect(gapWords(-0.3)).toEqual({ value: 'level', unit: '' });
	});
});

describe('where your ghost is (#3245)', () => {
	it('rides its metres between its seconds, and leaves at its end', () => {
		expect(ghostMetreAt(ghost, 0)).toBe(0);
		expect(ghostMetreAt(ghost, 200.5)).toBeCloseTo(1002.5, 10);
		expect(ghostMetreAt(ghost, 600)).toBe(3000);
		expect(ghostMetreAt(ghost, 600.5)).toBeNull();
		expect(ghostMetreAt([], 0)).toBeNull();
	});

	it('is named for the day you rode it', () => {
		// 11 Aug 2026 was a Tuesday, in the rider's own time.
		const label = ghostLabel(new Date(2026, 7, 11, 18, 30));
		expect(label).toMatch(/^Tuesday-you, /);
		expect(label).toContain('11');
		expect(label).toContain('Aug');
	});
});
