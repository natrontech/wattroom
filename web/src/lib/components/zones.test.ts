import { describe, expect, it } from 'vitest';
import type { Segment } from '$lib/workout/types';
import { hrZoneOf, hrZoneRanges, timeInZones, zoneOf } from './zones';

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

describe('timeInZones', () => {
	const steady = (seconds: number, target: number): Segment => ({
		kind: 'steady',
		startSeconds: 0,
		seconds,
		fromFraction: target,
		toFraction: target,
		stepIndex: 0,
	});

	it('buckets steady blocks by their target zone', () => {
		const zones = timeInZones([steady(600, 0.5), steady(300, 0.9)], 200);
		expect(zones[1]).toBe(600);
		expect(zones[3]).toBe(300);
	});

	it('counts ramps at their midpoint and skips sprints', () => {
		const ramp: Segment = {
			kind: 'ramp',
			startSeconds: 0,
			seconds: 600,
			fromFraction: 0.3,
			toFraction: 0.7, // midpoint 0.5 → Z1
			stepIndex: 0,
		};
		const sprint: Segment = {
			kind: 'sprint',
			startSeconds: 600,
			seconds: 15,
			stepIndex: 1,
		};
		const zones = timeInZones([ramp, sprint], 200);
		expect(zones[1]).toBe(600);
		expect(zones.reduce((a, b) => a + b, 0)).toBe(600);
	});

	it('honours absolute-watts overrides', () => {
		const seg: Segment = {
			kind: 'steady',
			startSeconds: 0,
			seconds: 60,
			watts: 250,
			stepIndex: 0,
		};
		expect(timeInZones([seg], 200)[zoneOf(250, 200)]).toBe(60);
	});
});
