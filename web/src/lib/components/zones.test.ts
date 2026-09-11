import { describe, expect, it } from 'vitest';
import {
	fillPct,
	hrZoneOf,
	hrZoneRanges,
	plannedZoneSeconds,
	zoneBands,
	zoneOf,
} from './zones';
import type { Segment } from '$lib/workout/types';

describe('zoneOf', () => {
	it('keeps SPEC boundaries inclusive on the low side', () => {
		expect(zoneOf(110, 200)).toBe(1); // 55 % is still Z1
		expect(zoneOf(112, 200)).toBe(2); // 56 %
		expect(zoneOf(210, 200)).toBe(4); // 105 % is still threshold
		expect(zoneOf(320, 200)).toBe(7); // 160 %
	});
});

describe('zoneBands', () => {
	it('cuts the axis at the SPEC boundaries, floor to ceiling with no gaps', () => {
		// An axis twice FTP: every zone edge lands inside it.
		const bands = zoneBands(200, 400);
		expect(bands.map((b) => b.zone)).toEqual([1, 2, 3, 4, 5, 6, 7]);
		expect(bands[0]).toEqual({ zone: 1, from: 0, to: 0.275 }); // 55 % of 200 / 400
		expect(bands[3].from).toBeCloseTo(0.45); // Z4 starts where Z3's 90 % ended
		// Contiguous, and the last band closes the axis: a gap paints a stripe
		// of nothing across the trace.
		for (let i = 1; i < bands.length; i++) {
			expect(bands[i].from).toBe(bands[i - 1].to);
		}
		expect(bands.at(-1)?.to).toBe(1);
	});

	it('stops at the ceiling rather than drawing zones the axis cannot show', () => {
		// A steady ride never above threshold: the axis tops out mid-Z4, so
		// Z5 upward have nowhere to go and Z4 takes the rest.
		const bands = zoneBands(200, 200);
		expect(bands.map((b) => b.zone)).toEqual([1, 2, 3, 4]);
		expect(bands.at(-1)).toEqual({ zone: 4, from: 0.9, to: 1 });
	});

	it('has no bands to draw without an FTP or an axis', () => {
		expect(zoneBands(0, 400)).toEqual([]);
		expect(zoneBands(200, 0)).toEqual([]);
	});
});

describe('hrZoneOf', () => {
	it('maps the SPEC table for LTHR 160', () => {
		expect(hrZoneOf(100, 160)).toBe(1); // 62 %
		expect(hrZoneOf(120, 160)).toBe(2); // 75 %
		expect(hrZoneOf(145, 160)).toBe(3); // 91 %
		expect(hrZoneOf(160, 160)).toBe(4); // 100 %
		expect(hrZoneOf(175, 160)).toBe(5); // 109 %
	});

	it('is zone 0 without an anchor or a reading', () => {
		expect(hrZoneOf(150, undefined)).toBe(0);
		expect(hrZoneOf(0, 160)).toBe(0);
	});

	it('agrees with the displayed ranges at every edge', () => {
		// 155 is the trap: 0.83 × 155 = 128.65, and rounding up would put the
		// displayed Z2 ceiling into Z3.
		for (const lthr of [150, 155, 163]) {
			for (const range of hrZoneRanges(lthr)) {
				expect(hrZoneOf(Math.max(1, range.low), lthr)).toBe(range.zone);
				if (range.high !== undefined)
					expect(hrZoneOf(range.high, lthr)).toBe(range.zone);
			}
		}
	});
});

describe('plannedZoneSeconds', () => {
	it('buckets steady, ramp, and sprint seconds by zone', () => {
		const zones = plannedZoneSeconds(
			[
				{
					kind: 'steady',
					stepPath: [0],
					startSeconds: 0,
					seconds: 600,
					fromFraction: 0.7,
					toFraction: 0.7,
				},
				// 50 → 60 % crosses the Z1/Z2 line exactly halfway through.
				{
					kind: 'ramp',
					stepPath: [0],
					startSeconds: 600,
					seconds: 100,
					fromFraction: 0.5,
					toFraction: 0.6,
				},
				{ kind: 'sprint', stepPath: [0], startSeconds: 700, seconds: 15 },
			],
			200,
		);
		expect(zones[1]).toBe(50);
		expect(zones[2]).toBe(650);
		expect(zones[7]).toBe(15);
		expect(zones.reduce((a, b) => a + b, 0)).toBe(715);
	});

	it('scores absolute-watt steps against FTP', () => {
		const zones = plannedZoneSeconds(
			[
				{
					kind: 'steady',
					stepPath: [0],
					startSeconds: 0,
					seconds: 60,
					watts: 250,
				},
			],
			250,
		);
		expect(zones[4]).toBe(60);
	});

	// #1003: the preview a rider steers by is only theirs if FTP reaches it —
	// the same minute of 250 W is all-out for one rider and endurance for another.
	it('puts one workout in different zones at different FTPs', () => {
		const workout: Segment[] = [
			{
				kind: 'steady',
				stepPath: [0],
				startSeconds: 0,
				seconds: 60,
				watts: 250,
			},
		];
		expect(plannedZoneSeconds(workout, 150)[7]).toBe(60);
		expect(plannedZoneSeconds(workout, 350)[2]).toBe(60);
	});
});

describe('fillPct', () => {
	it('scales to FTP × 1.5 by default, and to the scale it is given (#1565)', () => {
		expect(fillPct(270, 180)).toBe(100);
		expect(fillPct(400, 180)).toBe(100); // the room's instrument: pinned, by design
		expect(Math.round(fillPct(400, 180, 580))).toBe(69); // the ramp's: still moving
		expect(fillPct(580, 180, 580)).toBe(100);
	});
});
