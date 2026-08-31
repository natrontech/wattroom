import { describe, expect, it } from 'vitest';
import { plannedZoneSeconds, zoneOf } from './zones';

describe('zoneOf', () => {
	it('keeps SPEC boundaries inclusive on the low side', () => {
		expect(zoneOf(110, 200)).toBe(1); // 55 % is still Z1
		expect(zoneOf(112, 200)).toBe(2); // 56 %
		expect(zoneOf(210, 200)).toBe(4); // 105 % is still threshold
		expect(zoneOf(320, 200)).toBe(7); // 160 %
	});
});

describe('plannedZoneSeconds', () => {
	it('buckets steady, ramp, and sprint seconds by zone', () => {
		const zones = plannedZoneSeconds(
			[
				{
					kind: 'steady',
					stepIndex: 0,
					startSeconds: 0,
					seconds: 600,
					fromFraction: 0.7,
					toFraction: 0.7,
				},
				// 50 → 60 % crosses the Z1/Z2 line exactly halfway through.
				{
					kind: 'ramp',
					stepIndex: 0,
					startSeconds: 600,
					seconds: 100,
					fromFraction: 0.5,
					toFraction: 0.6,
				},
				{ kind: 'sprint', stepIndex: 0, startSeconds: 700, seconds: 15 },
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
					stepIndex: 0,
					startSeconds: 0,
					seconds: 60,
					watts: 250,
				},
			],
			250,
		);
		expect(zones[4]).toBe(60);
	});
});
