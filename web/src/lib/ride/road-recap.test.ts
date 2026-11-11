import { describe, expect, it } from 'vitest';
import { heightAt } from '#lib/road/at-metre.ts';
import { legsRoad } from '#lib/road/fixtures.ts';
import type { Road } from '#lib/road/road.ts';
import { roadRecap, timeUp, withBests, type RoadSample } from './road-recap';

// A synthetic road: 1 km flat, 2 km at 5 % (a class IV climb), 1 km flat.
const road = legsRoad([1000, 0], [2000, 5], [1000, 0]);

/** The rider at `speed` m/s along `r` from `from`, `seconds` long, at 200 W. */
function ride(r: Road, from: number, seconds: number, speed = 10) {
	const out: RoadSample[] = [];
	for (let t = 0; t < seconds; t++) {
		const m = Math.min(r.length, from + t * speed);
		out.push({ watts: 200, m, alt: heightAt(r, m) });
	}
	return out;
}

describe('roadRecap', () => {
	it('is null on a ride that never placed a second on a road', () => {
		const samples = Array.from({ length: 600 }, () => ({ watts: 200 }));
		expect(roadRecap(samples, { ftp: 250, timed: true })).toBeNull();
		expect(
			roadRecap(samples, { ftp: 250, timed: true, route: road }),
		).toBeNull();
	});

	it('times each classed climb a ride alone went up, in the route’s metres', () => {
		const recap = roadRecap(ride(road, 5, 400), {
			ftp: 250,
			timed: true,
			route: road,
		})!;
		expect(recap.stretch).toBe('km 0.0–4.0 · 100 m');
		expect(recap.climbs).toEqual([
			{ cls: 'IV', startM: 1000, topM: 3000, gainM: 100, seconds: 200 },
		]);
	});

	it('leaves out a climb the ride stopped short of the summit of', () => {
		const recap = roadRecap(ride(road, 5, 200), {
			ftp: 250,
			timed: true,
			route: road,
		})!;
		expect(recap.climbs).toEqual([]);
	});

	it('names the climbs of a bunch ride without anybody’s time', () => {
		// A session's own read: no route at hand, and a bunch times nobody.
		const recap = roadRecap(ride(road, 5, 400), { ftp: 250, timed: false })!;
		expect(recap.climbs).toHaveLength(1);
		expect(recap.climbs[0].cls).toBe('IV');
		expect(recap.climbs[0]).not.toHaveProperty('seconds');
	});

	it('colours the stretch by the zone ridden there', () => {
		const samples = ride(road, 5, 400).map((s, i) => ({
			...s,
			watts: i < 200 ? 100 : 300,
		}));
		const { zones } = roadRecap(samples, {
			ftp: 250,
			timed: true,
			columns: 4,
		})!;
		expect(zones).toEqual([1, 1, 5, 5]);
	});
});

describe('timeUp', () => {
	it('reads between seconds, as the server does', () => {
		expect(timeUp([0, 10, 20, 30, 40], 5, 35)).toBe(3);
	});

	it('is undefined for a stretch not passed, or passed backwards', () => {
		expect(timeUp([0, 10, 20], 5, 35)).toBeUndefined();
		expect(timeUp([40, 30, 20, 10], 15, 35)).toBeUndefined();
	});
});

describe('withBests', () => {
	const climbs = [
		{ cls: 'IV' as const, startM: 1000, topM: 3000, gainM: 100, seconds: 200 },
	];
	const best = { startM: 1000, topM: 3000, cls: 'IV', seconds: 200 };

	it('flags the climbs this ride holds the best on', () => {
		expect(withBests(climbs, [{ ...best, rideId: 'r1' }], 'r1')[0].pr).toBe(
			true,
		);
	});

	it('flags nothing when the best is another ride’s', () => {
		expect(
			withBests(climbs, [{ ...best, rideId: 'r0' }], 'r1')[0].pr,
		).toBeUndefined();
	});
});
