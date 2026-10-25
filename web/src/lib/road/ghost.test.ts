import { describe, expect, it } from 'vitest';
import {
	callMarks,
	callSaid,
	crossedMark,
	finishedIn,
	formatSplit,
	gapLine,
	gapSince,
	gapWords,
	ghostLabel,
	ghostMetreAt,
	newBestOn,
	secondsTo,
	splitAt,
} from './ghost';

// Your ghost rode 5 m a second from the start (#3033).
const ghost = Array.from({ length: 601 }, (_, t) => 5 * t);

describe('racing your ghost (#3033)', () => {
	it('knows when the ghost passed a metre, between its seconds', () => {
		expect(secondsTo(ghost, 1000)).toBe(200);
		expect(secondsTo(ghost, 1002.5)).toBeCloseTo(200.5, 10);
		expect(secondsTo(ghost, 5000)).toBeNull();
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

describe('the climb card’s gap since the foot (#3246)', () => {
	// You rode 6 m a second to the foot at 1,200 m (200 s; the ghost took
	// 240), then 4 m a second up it.
	const mine = Array.from({ length: 401 }, (_, t) =>
		t <= 200 ? 6 * t : 1200 + 4 * (t - 200),
	);
	it.each([
		// 100 m up: you took 25 s, the ghost 20 s.
		[1300, 225, 5],
		// 300 m up: 75 s against 60 s.
		[1500, 275, 15],
		// The foot itself: nothing gained or lost yet.
		[1200, 200, 0],
	])('at %i m after %i s reads %i s', (m, seconds, gap) => {
		expect(gapSince(ghost, mine, 1200, m, seconds)).toBeCloseTo(gap, 9);
	});

	it('reads nothing short of the foot or past the ghost’s end', () => {
		expect(gapSince(ghost, mine, 1200, 1100, 183)).toBeNull();
		expect(gapSince(ghost, mine, 1200, 3100, 675)).toBeNull();
	});

	it('names whose line it is, in words', () => {
		expect(gapLine(-12, true)).toBe('Your best · 12 s ahead');
		expect(gapLine(75, false)).toBe('Your last · 1:15 behind');
		expect(gapLine(0.3, true)).toBe('Your best · level');
	});
});

describe('the calls along a road (#3246)', () => {
	it('calls a quarter, halfway, three quarters and 500 m to go', () => {
		expect(callMarks(8000)).toEqual([
			{ m: 2000, name: 'A quarter in' },
			{ m: 4000, name: 'Halfway' },
			{ m: 6000, name: 'Three quarters in' },
			{ m: 7500, name: '500 m to go' },
		]);
		// Under 2 km, 500 m to go would come before three quarters.
		expect(callMarks(1600).map((k) => k.name)).toEqual([
			'A quarter in',
			'Halfway',
			'Three quarters in',
		]);
	});

	it('finds the mark a second crossed, once', () => {
		const marks = callMarks(8000);
		expect(crossedMark(marks, 3995, 4003)?.name).toBe('Halfway');
		expect(crossedMark(marks, 4003, 4010)).toBeNull();
		expect(crossedMark(marks, 0, 0)).toBeNull();
	});

	it('says the gap as the narrator speaks it', () => {
		expect(callSaid('Halfway', -12, true)).toBe(
			'Halfway, 12 seconds ahead of your best',
		);
		expect(callSaid('500 m to go', 61, false)).toBe(
			'500 m to go, 1 minute 1 second behind your last ride',
		);
		expect(callSaid('A quarter in', 120, true)).toBe(
			'A quarter in, 2 minutes behind your best',
		);
		expect(callSaid('Three quarters in', 0.4, true)).toBe(
			'Three quarters in, level with your best',
		);
	});
});

describe('a new best on a road (#3246)', () => {
	it('times a ghost saved on arrival to the end of its last second', () => {
		// 3,000 m, its last sample 5 m short: it ended there at 600 s.
		expect(finishedIn(ghost.slice(0, 600), 3000)).toBe(600);
		expect(finishedIn(ghost, 3000)).toBe(600);
	});

	it('says how much faster, in whole seconds', () => {
		expect(newBestOn('The Pass', -14.2)).toEqual({
			faster: '14 s faster',
			line: 'New best on The Pass, 14 s faster',
			said: 'New best on The Pass, 14 seconds faster',
		});
		expect(newBestOn('The Pass', -75)?.line).toBe(
			'New best on The Pass, 1:15 faster',
		);
		expect(newBestOn('The Pass', -0.4)).toBeNull();
		expect(newBestOn('The Pass', 3)).toBeNull();
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
