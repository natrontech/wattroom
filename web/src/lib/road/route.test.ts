import { describe, expect, it } from 'vitest';
import {
	BRIDGE_AT,
	HAIRPINS,
	SWITCHBACK_R,
	TUNNEL_AT,
	bridgeAndTunnel,
	bridgeAndTunnelRoad,
	hairpinClimb,
	spiky,
	switchback,
} from './fixtures';
import type { TrackPoint } from './parse';
import { decodePolyline6, packRoad, roadHash, roadStep } from './road';
import { toRoute, type Route } from './route';

const M_PER_DEG = (Math.PI / 180) * 6371008.8;

/** A straight track east from (46.6, 7.6), a fix every `spacing` m, heights by distance. */
function eastward(
	metres: number,
	spacing: number,
	ele: (s: number) => number = () => 500,
): TrackPoint[] {
	const kx = M_PER_DEG * Math.cos((46.6 * Math.PI) / 180);
	return Array.from({ length: Math.floor(metres / spacing) + 1 }, (_, i) => ({
		lat: 46.6,
		lon: 7.6 + (i * spacing) / kx,
		ele: ele(i * spacing),
	}));
}

const heightAt = (r: Route, s: number) => r.ele[Math.round(s / r.step)];

describe('toRoute', () => {
	it('makes the same route from the same points, byte for byte', async () => {
		const a = toRoute(hairpinClimb());
		const b = toRoute(hairpinClimb());
		expect(packRoad(b.road)).toEqual(packRoad(a.road));
		expect(b.shape).toBe(a.shape);
		expect(await roadHash(b.road)).toBe(await roadHash(a.road));
	});

	// The fixture's faults are a fix thrown 25 m to the side and a run that
	// overshoots down the road and walks back; the road itself is dead straight.
	it('drops the GPS spikes and leaves the road straight', () => {
		const r = toRoute(spiky());
		let wander = 0;
		for (const z of r.z) wander = Math.max(wander, Math.abs(z - r.z[0]));
		expect(wander).toBeLessThan(1);
		expect(r.length).toBeGreaterThan(2495);
		expect(r.length).toBeLessThan(2505);
	});

	// A 9 m hairpin's legs are 18 m apart, so the path never comes back within
	// the spike rule's 5 m — a rule judging by heading deletes it.
	it('keeps a 9 m switchback', () => {
		const r = toRoute(switchback());
		const drawn = 2000 + Math.PI * SWITCHBACK_R;
		expect(r.length).toBeGreaterThan(drawn - 10);
		expect(r.length).toBeLessThan(drawn);
		// The apex, east of the way out's halfway point: 500 m and the radius,
		// less the couple of metres the Gaussian draws a hairpin in by.
		const i = Math.round(500 / r.step);
		expect(Math.max(...r.x) - r.x[i]).toBeGreaterThan(500 + SWITCHBACK_R - 3);
		const legs = Math.hypot(
			r.x[i] - r.x[r.x.length - 1 - i],
			r.z[i] - r.z[r.x.length - 1 - i],
		);
		expect(legs).toBeCloseTo(2 * SWITCHBACK_R, 0);
	});

	// An out-and-back runs back down its own way in, inside the spike rule's
	// 5 m the whole way. Only the turn at the far end may go, never the return.
	it('keeps the way back of an out-and-back', () => {
		const out = eastward(1500, 8);
		const back = out
			.slice(0, -1)
			.reverse()
			.map((p) => ({ ...p, lat: p.lat + 2 / M_PER_DEG }));
		const r = toRoute([...out, ...back]);
		expect(r.length).toBeGreaterThan(3000 - 60);
	});

	// A median on a slope keeps a little of what it removes — the 2 % road's
	// lower side outnumbers its upper inside the window — so a tenth of the
	// 25 m dip is the bar, where an average alone leaves about two thirds.
	it('flattens the bridge the height model dropped and the tunnel it lifted', () => {
		const r = toRoute(bridgeAndTunnel());
		for (const s of [BRIDGE_AT, TUNNEL_AT])
			expect(Math.abs(heightAt(r, s) - bridgeAndTunnelRoad(s))).toBeLessThan(
				2.5,
			);
	});

	it('holds every step inside the stored grade range, heights included', () => {
		const wall = (s: number) =>
			500 + Math.min(Math.max(s - 1000, 0), 300) * 0.3;
		const r = toRoute(eastward(3000, 10, wall));
		expect(Math.max(...r.grade)).toBeLessThanOrEqual(20 + 1e-9);
		expect(Math.max(...r.grade)).toBeGreaterThan(19.9);
		const step = roadStep(r.road);
		for (let i = 1; i < r.road.heights.length; i++)
			expect(
				(r.road.heights[i] - r.road.heights[i - 1]) / step,
			).toBeLessThanOrEqual(0.2 + 0.01 / step);
	});

	// #3047 finds a hairpin as more than 2.4 rad of turn within 240 m, 300 m
	// from the last: the turns are what it reads, so they must carry all 21.
	it('keeps every hairpin in the turns', () => {
		const r = toRoute(hairpinClimb());
		const step = roadStep(r.road);
		const within = Math.round(240 / step);
		const apart = Math.round(300 / step);
		let found = 0;
		let last = -Infinity;
		for (let i = 0; i + within <= r.road.turns.length; i++) {
			let sum = 0;
			for (let k = i; k < i + within; k++) sum += r.road.turns[k];
			if (Math.abs((sum * Math.PI) / 180) > 2.4 && i - last >= apart) {
				found++;
				last = i;
			}
		}
		expect(found).toBe(HAIRPINS);
	});

	// Positive turns right, as a compass bearing grows. The right-hand hairpin
	// passes due south, where the bearing wraps: read raw, that is a turn of
	// 360° the other way. Summed away from the ends, which the fixture's
	// 18 m gap makes a loop of.
	it('turns the way the road turns, through due south too', () => {
		const hairpin = (side: 1 | -1) => {
			const { road } = toRoute(switchback(side));
			const from = Math.round(500 / roadStep(road));
			return road.turns
				.slice(from, road.turns.length - from)
				.reduce((a, b) => a + b, 0);
		};
		expect(Math.abs(hairpin(1) + 180)).toBeLessThan(10);
		expect(Math.abs(hairpin(-1) - 180)).toBeLessThan(10);
	});

	it('stores every other sample, the last on the end', () => {
		const r = toRoute(switchback());
		expect(r.road.heights).toHaveLength((r.x.length - 1) / 2 + 1);
		expect(r.road.turns).toHaveLength(r.road.heights.length - 1);
		expect(r.road.length).toBeCloseTo(r.length, 2);
		expect(r.road.heights.at(-1)).toBeCloseTo(r.ele[r.ele.length - 1], 2);
	});

	it('names the road by its numbers, never by the file', () => {
		expect(toRoute(switchback()).name).toMatch(/^Road · 2\.0 km · 1\d\d m$/);
	});

	it('keeps the owner’s shape as polyline6 of the smoothed line', () => {
		const r = toRoute(switchback());
		const shape = decodePolyline6(r.shape);
		expect(shape).toHaveLength(r.x.length);
		// Consecutive points a step apart, to the 1e-6° (~0.1 m) it keeps.
		const kx = M_PER_DEG * Math.cos((shape[0].lat * Math.PI) / 180);
		for (let i = 1; i < shape.length; i++) {
			const d = Math.hypot(
				(shape[i].lat - shape[i - 1].lat) * M_PER_DEG,
				(shape[i].lon - shape[i - 1].lon) * kx,
			);
			expect(
				Math.abs(d - Math.hypot(r.x[i] - r.x[i - 1], r.z[i] - r.z[i - 1])),
			).toBeLessThan(0.3);
		}
	});

	it('refuses a route under 2 km or over 200 km, saying why', () => {
		expect(() => toRoute(eastward(1900, 20))).toThrow(/at least 2 km/);
		expect(() => toRoute(eastward(201_000, 200))).toThrow(/at most 200 km/);
	});
});
