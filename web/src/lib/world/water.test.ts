import { beforeAll, describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { HOME_ROADS, homeRoute } from '#lib/ride/home-roads.ts';
import type { Water } from './designed';
import { routeOfRoad } from './road-route';
import { generate, type World } from './world';
import { waterSheets } from './water';
import { BUILD_MS } from './world.test-helper';

/**
 * The water's sheet (water.ts): its depth is the depth over the ground the
 * rider sees, so the foam line lies on the drawn shore and the bands follow
 * the design's basin; it covers every bit of drawn ground under the water;
 * and running water runs down its course, faster where it falls.
 */
describe('the water of a designed road', () => {
	let world: World;
	let lake: Water;
	let still: THREE.BufferGeometry;
	let streams: THREE.BufferGeometry;
	beforeAll(async () => {
		const road = (await homeRoute(HOME_ROADS.find((r) => r.id === 'urnsee')!))
			.road;
		const route = routeOfRoad(road);
		world = generate(route);
		lake = world.waters.find((w) => !w.run && !w.course)!;
		still = waterSheets(route, [lake], world.heightAt);
		streams = waterSheets(
			route,
			world.waters.filter((w) => w.run),
			world.heightAt,
		);
	}, BUILD_MS);

	/** Metres from (x, z) to the lake's shore. */
	const off = (x: number, z: number) => {
		let best = Infinity;
		const o = lake.outline;
		for (let i = 0; i < o.length; i++) {
			const a = o[i];
			const b = o[(i + 1) % o.length];
			const sx = b[0] - a[0];
			const sz = b[1] - a[1];
			const t = Math.min(
				1,
				Math.max(0, ((x - a[0]) * sx + (z - a[1]) * sz) / (sx * sx + sz * sz)),
			);
			best = Math.min(best, Math.hypot(a[0] + sx * t - x, a[1] + sz * t - z));
		}
		return best;
	};

	it('is as deep as the water over the drawn ground near the shore, and dry where the ground comes out of it', () => {
		const pos = still.getAttribute('position');
		const depth = still.getAttribute('depth');
		let near = 0;
		for (let i = 0; i < pos.count; i++) {
			const x = pos.getX(i);
			const z = pos.getZ(i);
			if (off(x, z) > 10) continue;
			near++;
			expect(depth.getX(i)).toBeCloseTo(lake.level - world.heightAt(x, z), 2);
		}
		expect(near).toBeGreaterThan(200);
	});

	it('covers all the drawn ground under it', () => {
		const pos = still.getAttribute('position');
		const index = still.getIndex()!;
		// The lattice cells the sheet covers, by their south-west corner.
		const covered = new Set<string>();
		for (let t = 0; t < index.count; t += 3) {
			const xs = [0, 1, 2].map((k) => pos.getX(index.getX(t + k)));
			const zs = [0, 1, 2].map((k) => pos.getZ(index.getX(t + k)));
			for (let x = Math.min(...xs); x < Math.max(...xs) - 1; x += 10)
				for (let z = Math.min(...zs); z < Math.max(...zs) - 1; z += 10)
					covered.add(`${Math.round(x / 10)}:${Math.round(z / 10)}`);
		}
		const o = lake.outline;
		let under = 0;
		for (let i = 0; i < o.length; i++) {
			// Across the shore, from 12 m out to 12 m in, a metre at a time.
			const [ax, az] = o[i];
			const [bx, bz] = o[(i + 1) % o.length];
			const len = Math.hypot(bx - ax, bz - az) || 1;
			for (let k = -12; k <= 12; k++) {
				const x = ax - ((bz - az) / len) * k;
				const z = az + ((bx - ax) / len) * k;
				if (world.heightAt(x, z) > lake.level - 0.05) continue;
				under++;
				expect(covered.has(`${Math.floor(x / 10)}:${Math.floor(z / 10)}`)).toBe(
					true,
				);
			}
		}
		expect(under).toBeGreaterThan(100);
	});

	it('deepens from the shore to the middle, as its bed falls', () => {
		const pos = still.getAttribute('position');
		const depth = still.getAttribute('depth');
		const bands: number[][] = [[], [], [], []];
		for (let i = 0; i < pos.count; i++) {
			const x = pos.getX(i);
			const z = pos.getZ(i);
			if (world.waterAt(x, z) !== lake.level) continue;
			const o = off(x, z);
			bands[o < 10 ? 0 : o < 25 ? 1 : o < 60 ? 2 : 3].push(depth.getX(i));
		}
		const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1];
		for (const b of bands) expect(b.length).toBeGreaterThan(5);
		const m = bands.map(median);
		expect(m[0]).toBeLessThan(m[1]);
		expect(m[1]).toBeLessThan(m[2]);
		expect(m[2]).toBeLessThan(m[3]);
	});

	it('runs down a stream, faster where it falls', () => {
		const flow = streams.getAttribute('flow');
		const foam = streams.getAttribute('foam');
		const calm: number[] = [];
		const white: number[] = [];
		for (let i = 0; i < flow.count; i++) {
			expect(flow.getZ(i)).toBeGreaterThan(0);
			if (foam.getX(i) > 0.9) white.push(flow.getZ(i));
			else if (foam.getX(i) < 0.05) calm.push(flow.getZ(i));
		}
		expect(white.length).toBeGreaterThan(0);
		expect(calm.length).toBeGreaterThan(0);
		expect(Math.min(...white)).toBeGreaterThan(Math.max(...calm));
	});
});
