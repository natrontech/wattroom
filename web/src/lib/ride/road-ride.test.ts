import { describe, expect, it } from 'vitest';
import { heightAt } from '$lib/road/at-metre';
import type { Road } from '$lib/road/road';
import type { RoadSecond } from './road-ride';
import { createRoadLaps, createRoadRide } from './road-ride';
import { feltGrade } from './ride-grade';

// 2 km sampled every 20 m: up 2 % to 1 km, then down 1 % (the server's own
// test road, server/internal/road/profile_test.go).
const upThenDown: Road = {
	length: 2000,
	heights: Array.from({ length: 101 }, (_, i) =>
		i <= 50 ? 100 + 0.4 * i : 120 - 0.2 * (i - 50),
	),
	turns: Array<number>(100).fill(0),
};
const kg = () => 75;

/** `seconds` samples one second apart at `watts`. */
function riddenFor(
	ride: ReturnType<typeof createRoadRide>,
	watts: number,
	seconds: number,
	t0 = 0,
) {
	let last = ride.second(watts, t0);
	for (let s = 1; s < seconds; s++) last = ride.second(watts, t0 + s * 1000);
	return last;
}

describe('a ride on a stored road (#3027)', () => {
	it('moves the dot by the watts, and reads the road where it is', () => {
		const ride = createRoadRide(upThenDown, { kg });
		const at = riddenFor(ride, 200, 60);
		expect(at.m).toBeGreaterThan(200);
		expect(at.virtualMps).toBeGreaterThan(3);
		expect(at.alt).toBeCloseTo(heightAt(upThenDown, at.m), 9);
		expect(at.roadPct).toBeCloseTo(2, 9);
		// Felt is half the road's grade, reached through the slew.
		expect(at.felt).toBeCloseTo(feltGrade(2), 9);
	});

	it('catches up at most two seconds after a throttled gap', () => {
		const steady = createRoadRide(upThenDown, { kg });
		const gapped = createRoadRide(upThenDown, { kg });
		riddenFor(steady, 250, 30);
		riddenFor(gapped, 250, 30);
		const after2 = createRoadRide(upThenDown, { kg });
		riddenFor(after2, 250, 30);
		after2.second(250, 30_000);
		const two = after2.second(250, 31_000);
		// A 20 s gap moves no further than two one-second samples do.
		const jumped = gapped.second(250, 29_000 + 20_000);
		expect(jumped.m).toBeLessThanOrEqual(two.m + 1e-9);
		expect(jumped.m).toBeGreaterThan(steady.second(250, 30_000).m - 1e-9);
	});

	it('starts a resumed ride at its metre', () => {
		const ride = createRoadRide(upThenDown, { kg, from: 1500 });
		const first = ride.second(0, 0);
		expect(first.m).toBeCloseTo(1500, 0);
		expect(first.roadPct).toBeCloseTo(-1, 9);
	});

	it('stops the dot at the end of the road', () => {
		const ride = createRoadRide(upThenDown, { kg, from: 1990 });
		const end = riddenFor(ride, 300, 30);
		expect(end.m).toBe(upThenDown.length);
		expect(end.virtualMps).toBe(0);
	});
});

describe('the end of the road, and laps (#3205)', () => {
	/** Rides until the dot reaches the end of its way; the last second. */
	function toTheEnd(second: (watts: number, at: number) => RoadSecond) {
		let last = second(400, 0);
		for (let s = 1; !last.atEnd; s++) {
			expect(s, 'never reached the end').toBeLessThan(3600);
			last = second(400, s * 1000);
		}
		return last;
	}

	it('stops the dot at the end and says so', () => {
		const ride = createRoadRide(upThenDown, { kg });
		const end = toTheEnd(ride.second);
		expect(end.m).toBe(2000);
		expect(end.virtualMps).toBe(0);
		expect(ride.second(400, 4_000_000).m).toBe(2000);
	});

	it('rides back the way it came: the metres count down, and what went down climbs', () => {
		const back = createRoadRide(upThenDown, { kg, from: 2000, reverse: true });
		const first = back.second(250, 0);
		const later = back.second(250, 1000);
		expect(later.m).toBeLessThan(first.m);
		expect(first.m).toBeLessThan(2000);
		// The 1 % descent is a 1 % climb ridden from the far end.
		expect(first.roadPct).toBeCloseTo(1, 9);
		expect(first.alt).toBeCloseTo(heightAt(upThenDown, first.m), 9);
		const home = toTheEnd(back.second);
		expect(home.m).toBe(0);
	});

	it('numbers each lap and marks the first sample of a lap run backwards', () => {
		const laps = createRoadLaps(upThenDown, { kg });
		expect(laps.fields(laps.second(400, 0))).toEqual({
			m: expect.any(Number),
			alt: expect.any(Number),
		});
		toTheEnd(laps.second);
		laps.turn('back');
		const opening = laps.fields(laps.second(400, 0));
		expect(opening).toMatchObject({ lap: 1, reverse: true });
		expect(opening.m).toBeLessThan(2000);
		const next = laps.fields(laps.second(400, 1000));
		expect(next.lap).toBe(1);
		expect(next.reverse).toBeUndefined();
		expect(next.m).toBeLessThan(opening.m);

		toTheEnd(laps.second);
		laps.turn('again');
		const again = laps.fields(laps.second(400, 0));
		// Again the way it last ran: down the stored road from its far end.
		expect(again).toMatchObject({ lap: 2, reverse: true });
		expect(again.m).toBeGreaterThan(1900);
	});

	it('rides it again from the start, up the road', () => {
		const laps = createRoadLaps(upThenDown, { kg });
		toTheEnd(laps.second);
		laps.turn('again');
		const again = laps.fields(laps.second(400, 0));
		expect(again.lap).toBe(1);
		expect(again.reverse).toBeUndefined();
		expect(again.m).toBeLessThan(100);
	});
});
