import { beforeAll, describe, expect, it } from 'vitest';
import { roadIndex } from './field';
import { steadySpeed, step } from './physics';
import { parseGpx } from './gpx';
import { at, toRoute, type Route } from './route';
import { SYNTHETIC_NAME, syntheticGpx, syntheticPoints } from './synthetic';
import { generate, type World } from './world';

/**
 * The prototype's check.ts, as tests (#3021): the smallest set of things
 * that fail when the route, the physics or the world generator break. They
 * run on the synthetic loop, so they need no real-world track.
 */

let route: Route;
let world: World;
beforeAll(() => {
	route = toRoute(SYNTHETIC_NAME, syntheticPoints());
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

describe('the route', () => {
	it('reads the synthetic GPX the way it reads a rider’s file', () => {
		const { name, points } = parseGpx(syntheticGpx());
		expect(name).toBe(SYNTHETIC_NAME);
		const fromFile = toRoute(name, points);
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

describe('the physics', () => {
	const rider = { mass: 80 };

	it('rides 200 W on the flat at a road bike’s speed', () => {
		const kmh = steadySpeed(200, 0, rider) * 3.6;
		expect(kmh).toBeGreaterThan(30);
		expect(kmh).toBeLessThan(36);
	});

	it('integrates to the same steady speed', () => {
		let v = 0;
		for (let t = 0; t < 120; t += 0.1) v = step(v, 200, 0, rider, 0.1);
		expect(Math.abs(v - steadySpeed(200, 0, rider)) * 3.6).toBeLessThan(0.5);
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
		let worst = -Infinity;
		for (let i = 0; i < route.x.length; i += 7)
			worst = Math.max(
				worst,
				world.heightAt(route.x[i], route.z[i]) - route.ele[i],
			);
		expect(worst).toBeLessThan(0.2);
	});

	it('folds no terrain face into a wall steeper than 58°', () => {
		const { pos, index } = world.mesh;
		let folds = 0;
		const flat = (p: number, q: number) =>
			Math.hypot(pos[p * 3] - pos[q * 3], pos[p * 3 + 2] - pos[q * 3 + 2]);
		for (let t = 0; t < index.length; t += 3) {
			const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
			const ys = [pos[a * 3 + 1], pos[b * 3 + 1], pos[c * 3 + 1]];
			const span = Math.max(flat(a, b), flat(b, c), flat(c, a), 1);
			if ((Math.max(...ys) - Math.min(...ys)) / span > 1.6) folds++;
		}
		expect(folds).toBe(0);
	});
});
