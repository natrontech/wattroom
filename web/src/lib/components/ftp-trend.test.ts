import { describe, expect, it } from 'vitest';
import type { TrendRide } from '$lib/progression';
import { ftpMarks, trendDomain, trendSparse } from './ftp-trend';

const DAY = 24 * 60 * 60 * 1000;
const day0 = Date.parse('2026-09-01T07:00:00Z');

function ride(
	n: number,
	over: Partial<TrendRide> & { day?: number } = {},
): TrendRide {
	const { day = n, ...rest } = over;
	return {
		id: `r${n}`,
		date: new Date(day0 + day * DAY).toISOString(),
		seconds: 3600,
		kj: 700,
		execution: 0.9,
		ftp: 250,
		best20m: 0,
		...rest,
	};
}

describe('trendSparse', () => {
	it('is sparse with nothing, or with one ride', () => {
		// A point is not a trend: this is the "9 Sept – 9 Sept" flat line the
		// report opened on (#1572).
		expect(trendSparse([])).toBe(true);
		expect(trendSparse([ride(0, { ftpAfter: 275 })])).toBe(true);
	});

	it('is sparse for a few days at one FTP with nothing marked', () => {
		expect(trendSparse([ride(0), ride(1), ride(2)])).toBe(true);
	});

	it('draws once a week of rides has passed', () => {
		expect(trendSparse([ride(0), ride(8)])).toBe(false);
	});

	it('draws once the FTP has moved', () => {
		expect(trendSparse([ride(0), ride(1, { ftp: 275 })])).toBe(false);
	});

	it('draws for a 20-minute dot inside the week', () => {
		expect(trendSparse([ride(0), ride(1, { best20m: 260 })])).toBe(false);
	});

	it('draws for a ramp test inside the week', () => {
		// The point of #1572: the ramp's own ride is the mark, so the chart no
		// longer waits for the next ride to have something to show.
		expect(trendSparse([ride(0), ride(1, { ftpAfter: 275 })])).toBe(false);
	});
});

describe('ftpMarks', () => {
	it('is empty when no ride produced an FTP', () => {
		expect(ftpMarks([ride(0), ride(1, { best20m: 260 })])).toEqual([]);
	});

	it('is empty when every ride carries ftpAfter: null', () => {
		// The column is nullable and the field omitted, but a client that
		// sends an explicit null must not draw a diamond at 0 W either.
		const nulled = [ride(0), ride(1)].map((r) => ({
			...r,
			ftpAfter: null as unknown as undefined,
		}));
		expect(ftpMarks(nulled)).toEqual([]);
		expect(trendSparse(nulled)).toBe(true);
	});

	it('picks only the rides that produced one', () => {
		const rides = [ride(0), ride(1, { ftpAfter: 275 }), ride(2)];
		expect(ftpMarks(rides).map((r) => r.id)).toEqual(['r1']);
	});
});

describe('trendDomain', () => {
	it('holds the ramp mark inside the axis', () => {
		// A produced FTP above every other number used to sit off the top:
		// the domain read ftp and best20m only.
		const { hi } = trendDomain([ride(0), ride(1, { ftpAfter: 400 })]);
		expect(hi).toBeGreaterThan(400);
	});

	it('ignores the zeros, and survives having only them', () => {
		expect(trendDomain([ride(0), ride(1)])).toEqual({ lo: 240, hi: 260 });
		expect(trendDomain([])).toEqual({ lo: 0, hi: 1 });
	});
});
