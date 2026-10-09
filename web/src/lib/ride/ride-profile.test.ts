import { describe, expect, it } from 'vitest';
import { climbsOf } from '$lib/road/climbs';
import { chipsIn, tileOf } from '$lib/road/skyline';
import { rideProfile, riddenM, wholeRoadFrame } from './ride-profile';

/** A synthetic ride (#3639): a second a sample at `mps`, up `pct` % from 100 m. */
function ride(seconds: number, mps: number, pct: number, from = 0) {
	return Array.from({ length: seconds }, (_, i) => {
		const m = from + i * mps;
		return { m, alt: 100 + (m * pct) / 100 };
	});
}

describe('a road ride’s own profile (#3639)', () => {
	it('draws its heights over the metres it rode', () => {
		const road = rideProfile(ride(300, 5, 6))!;
		expect(road.length).toBeCloseTo(1495, 5);
		expect(road.heights[0]).toBeCloseTo(100, 5);
		expect(road.heights.at(-1)).toBeCloseTo(100 + 1495 * 0.06, 5);
		// Every 20 m or a little over, as a road is stored.
		expect(road.length / (road.heights.length - 1)).toBeGreaterThanOrEqual(20);
		expect(road.length / (road.heights.length - 1)).toBeLessThan(21);
	});

	it('reads a saved zero as the zero it was', () => {
		const samples = ride(120, 5, 4).map((s, i) =>
			i === 0 ? { alt: s.alt } : s,
		);
		expect(rideProfile(samples)!.length).toBeCloseTo(595, 5);
	});

	it('rides a lap back down as more road, and a lap again from the start too', () => {
		const up = ride(200, 10, 5);
		const down = up.map((s) => ({ ...s })).reverse();
		const back = rideProfile([...up, ...down])!;
		expect(back.length).toBeCloseTo(2 * 1990, 5);
		// Up to the top — within a stored step of it — and back down.
		expect(Math.max(...back.heights)).toBeGreaterThan(100 + 1990 * 0.05 - 1);
		expect(back.heights.at(-1)).toBeCloseTo(100, 5);
		// Ride it again: the jump from the top to the start is no ride.
		const again = rideProfile([...up, ...up])!;
		expect(again.length).toBeCloseTo(2 * 1990, 5);
	});

	it('draws nothing off a road, or for a ride too short to draw', () => {
		expect(rideProfile([{}, {}, {}])).toBeNull();
		expect(rideProfile(ride(3, 5, 0))).toBeNull();
	});

	it('fills one frame with the whole road, and marks its climbs where they top out', () => {
		const road = rideProfile(ride(600, 5, 6))!;
		const frame = wholeRoadFrame(road, 1000, 120);
		const tile = tileOf(frame, road, 0);
		expect(tile.width).toBeCloseTo(1000, 5);
		// 6 % is the third of the five grade steps.
		expect(tile.areas[2]).not.toBe('');
		const chips = chipsIn(frame, road, climbsOf(road));
		expect(chips.length).toBeGreaterThan(0);
		expect(chips[0].x).toBeGreaterThan(900);
	});
});

describe('a road ride’s one distance (#3931)', () => {
	it('says the server’s replay over the samples’ own metres', () => {
		const road = rideProfile(ride(300, 2.5, 3))!;
		expect(riddenM(road, 1300)).toBe(1300);
	});

	it('falls back to the samples’ metres for a ride without a replay', () => {
		const road = rideProfile(ride(300, 5, 6))!;
		expect(riddenM(road)).toBeCloseTo(1495, 5);
	});
});
