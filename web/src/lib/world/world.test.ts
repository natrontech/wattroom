// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { roadIndex } from './field';
import { RouteError, parseRoute } from '$lib/road/parse';
import { toRoute, type Route } from '$lib/road/route';
import { at } from '$lib/road/along';
import { syntheticGpx, syntheticPoints } from './synthetic';
import { generate, type World } from './world';
import { folds, worstRiseThroughRoad } from './world.test-helper';

/**
 * The prototype's check.ts, as tests (#3021): the smallest set of things
 * that fail when the route, the physics or the world generator break. They
 * run on the synthetic loop, so they need no real-world track.
 */

let route: Route;
let world: World;
beforeAll(() => {
	route = toRoute(syntheticPoints());
	world = generate(route);
});

/** The cosine between each pair of consecutive segments of a polyline. */
function turns(x: ArrayLike<number>, z: ArrayLike<number>): number[] {
	const out: number[] = [];
	for (let i = 1; i < x.length - 1; i++) {
		const ax = x[i] - x[i - 1];
		const az = z[i] - z[i - 1];
		const bx = x[i + 1] - x[i];
		const bz = z[i + 1] - z[i];
		out.push(
			(ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz) || 1),
		);
	}
	return out;
}

/**
 * How fast a rider moving along the route moves in space around the start of
 * a lap, slowest and fastest, per metre of distance: 1 is a steady ride.
 */
function paceAcrossStart(r: Route): { slowest: number; fastest: number } {
	const dd = 0.1;
	let slowest = Infinity;
	let fastest = -Infinity;
	let prev = at(r, r.length - 60);
	for (let d = r.length - 60 + dd; d <= r.length + 60; d += dd) {
		const p = at(r, d);
		const pace = Math.hypot(p.x - prev.x, p.z - prev.z) / dd;
		slowest = Math.min(slowest, pace);
		fastest = Math.max(fastest, pace);
		prev = p;
	}
	return { slowest, fastest };
}

describe('the route', () => {
	it('reads the synthetic GPX the way it reads a rider’s file', () => {
		const fromFile = toRoute(parseRoute(syntheticGpx()).points);
		expect(fromFile.length).toBeCloseTo(route.length, 0);
		expect(fromFile.gain).toBeCloseTo(route.gain, 0);
	});

	it('is a loop of sane length and climb', () => {
		expect(route.loop).toBe(true);
		expect(route.length).toBeGreaterThan(25_000);
		expect(route.length).toBeLessThan(40_000);
		expect(route.gain).toBeGreaterThan(500);
		expect(route.gain).toBeLessThan(800);
		const p = at(route, route.length + 5);
		expect(Math.hypot(p.x - route.x[0], p.z - route.z[0])).toBeLessThan(20);
	});

	it('rides through the start of a lap at the speed it rides the rest', () => {
		const { slowest, fastest } = paceAcrossStart(route);
		expect(slowest).toBeGreaterThan(0.9);
		expect(fastest).toBeLessThan(1.1);
	});

	it('rides as steadily across a loop whose track stops short of its start', () => {
		const short = syntheticPoints().slice(0, -8); // ~60 m short
		const open = toRoute(short);
		expect(open.loop).toBe(true);
		const { slowest, fastest } = paceAcrossStart(open);
		expect(slowest).toBeGreaterThan(0.9);
		expect(fastest).toBeLessThan(1.1);
	});

	it('refuses a track too short to build a road on', () => {
		const here = { lat: 46.6, lon: 7.6, ele: 500 };
		expect(() => toRoute([here, { ...here }])).toThrow(RouteError);
	});

	it('removes the reversal the track carries, and leaves none', () => {
		// The fixture's out-and-back is really there, or this proves nothing.
		const raw = syntheticPoints();
		const back = turns(
			raw.map((p) => p.lon),
			raw.map((p) => -p.lat),
		).filter((cos) => cos < -0.5);
		expect(back.length).toBeGreaterThan(0);

		const reversals = turns(route.x, route.z)
			.map((cos, i) => ({ cos, km: ((i + 1) * route.step) / 1000 }))
			.filter((s) => s.cos <= -0.5)
			.map((s) => `the road doubles back at ${s.km.toFixed(2)} km`);
		expect(reversals).toEqual([]);
	});

	it('has the climb, the hairpins and the villages it was drawn with', () => {
		const kinds = world.markers.map((m) => m.kind);
		expect(kinds.filter((k) => k === 'climb').length).toBeGreaterThanOrEqual(1);
		expect(kinds.filter((k) => k === 'hairpin').length).toBe(5);
		expect(world.villageNames.length).toBeGreaterThanOrEqual(1);
	});
});

describe('the world', () => {
	it('is the same world for the same route', () => {
		// Element by element: `toEqual` walks 700k terrain floats slowly enough
		// to time out on a loaded CI runner.
		const identical = (a: ArrayLike<number>, b: ArrayLike<number>) => {
			if (a.length !== b.length) return false;
			for (let i = 0; i < a.length; i++)
				if (!Object.is(a[i], b[i])) return false;
			return true;
		};
		const again = generate(route);
		expect(again.seed).toBe(world.seed);
		expect(identical(again.trees, world.trees)).toBe(true);
		expect(identical(again.houses, world.houses)).toBe(true);
		expect(identical(again.mesh.pos, world.mesh.pos)).toBe(true);
		expect(JSON.stringify(again.pieces)).toBe(JSON.stringify(world.pieces));
	});

	it('keeps everything beside the road clear of it', () => {
		const near = roadIndex(route).nearest;
		const offenders: string[] = [];
		const check = (label: string, x: number, z: number, min: number) => {
			const hit = near(x, z, 3);
			if (hit && hit.d < min)
				offenders.push(`${label} ${hit.d.toFixed(1)} m from the centreline`);
		};
		const props = [
			['tree', world.trees, 5, 10],
			['house', world.houses, 5, 12],
			['cow', world.cows, 4, 18],
			['rock', world.rocks, 4, 8],
		] as const;
		for (const [label, arr, stride, min] of props)
			for (let k = 0; k < arr.length; k += stride)
				check(label, arr[k], arr[k + 2], min);
		// Set pieces keep 6 m off the asphalt (edge at 3.2 m); road furniture excepted.
		for (const p of world.pieces)
			if (p.kind !== 'delineator' && p.kind !== 'snowpole')
				check(p.kind, p.x, p.z, 9);
		expect(world.trees.length).toBeGreaterThan(0);
		expect(offenders).toEqual([]);
	});

	it('never lifts the ground through the road', () => {
		expect(worstRiseThroughRoad(route, world)).toBeLessThan(0.2);
	});

	it('folds no terrain face into a wall steeper than 58°', () => {
		expect(folds(world)).toBe(0);
	});
});
