import { describe, expect, it } from 'vitest';
import { attemptPoints, attemptTrend, type Attempt } from './attempts';

const ride = (
	day: number,
	kmh: number,
	kind: Attempt['kind'] = 'timed',
): Attempt => ({
	rideId: `r${day}-${kind}`,
	startedAt: new Date(Date.UTC(2026, 8, day)).toISOString(),
	seconds: 3600,
	distanceM: kmh * 1000,
	kind,
});

describe('a route attempts chart (#3615)', () => {
	it('places each ride at its average speed, oldest first, and skips one with no distance', () => {
		const points = attemptPoints([
			ride(3, 30),
			ride(1, 25, 'erg'),
			{ ...ride(2, 28), distanceM: undefined },
		]);
		expect(points.map((p) => [Math.round(p.kmh), p.solid])).toEqual([
			[25, false],
			[30, true],
		]);
	});

	it('trends the timed rides alone', () => {
		// The ERG ride is far below the line; trended with the rest, it would
		// tip the line down though every timed ride got faster.
		const trend = attemptTrend(
			attemptPoints([ride(1, 25), ride(2, 5, 'erg'), ride(3, 27), ride(5, 31)]),
		);
		expect(trend).not.toBeNull();
		expect(trend!.to.kmh).toBeGreaterThan(trend!.from.kmh);
		expect(trend!.from.kmh).toBeCloseTo(24.667, 2);
		expect(trend!.to.kmh).toBeCloseTo(30.667, 2);
	});

	it('draws no trend under two timed rides', () => {
		expect(
			attemptTrend(attemptPoints([ride(1, 25), ride(2, 30, 'together')])),
		).toBeNull();
		expect(attemptTrend([])).toBeNull();
	});
});
