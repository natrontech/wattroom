import { beforeAll, describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import type { Route } from '#lib/road/route.ts';
import { HOME_ROADS, homeRoute } from '#lib/ride/home-roads.ts';
import { wetWithin, type Water } from './designed';
import { landOf } from './designs';
import { routeOfRoad } from './road-route';
import { generate, type World } from './world';
import {
	WATER_TILE_M,
	waterSheets,
	waterTiles,
	type ShorePoint,
} from './water';
import { shoreDressing } from './shore';
import { rideLook } from './look';
import { FORMATION } from './terrain/road-profile';
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
	let route: Route;
	const waterline: ShorePoint[] = [];
	beforeAll(async () => {
		const road = (await homeRoute(HOME_ROADS.find((r) => r.id === 'urnsee')!))
			.road;
		route = routeOfRoad(road);
		world = generate(route);
		waterSheets(route, world.waters, world.heightAt, waterline);
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

	it('leaves its island dry: a hole in the sheet, with a waterline of its own', () => {
		const isle = lake.islands![0];
		const ring = (x: number, z: number) => {
			let odd = false;
			let best = Infinity;
			for (let i = 0, j = isle.length - 1; i < isle.length; j = i++) {
				const [xi, zi] = isle[i];
				const [xj, zj] = isle[j];
				if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
					odd = !odd;
				const sx = xi - xj;
				const sz = zi - zj;
				const t = Math.min(
					1,
					Math.max(0, ((x - xj) * sx + (z - zj) * sz) / (sx * sx + sz * sz)),
				);
				best = Math.min(best, Math.hypot(xj + sx * t - x, zj + sz * t - z));
			}
			return { on: odd, off: best };
		};
		const pos = still.getAttribute('position');
		for (let i = 0; i < pos.count; i++) {
			const r = ring(pos.getX(i), pos.getZ(i));
			// The sheet reaches a lattice cell or two up its shore, where the drawn ground stands over it, and no further.
			if (r.on) expect(r.off).toBeLessThan(25);
		}
		const own = waterline.filter((p) => {
			const r = ring(p.x, p.z);
			return r.off < 15;
		});
		expect(own.length).toBeGreaterThan(10);
	});

	it('is drawn in tiles, every triangle in one of them', () => {
		const tiles = waterTiles(still);
		expect(tiles.length).toBeGreaterThan(4);
		expect(tiles.reduce((n, g) => n + g.index!.count, 0)).toBe(
			still.index!.count,
		);
		for (const g of tiles) {
			const b = g.boundingBox!;
			// A triangle belongs to the tile its middle lies in, and reaches a lattice cell or a chunk past it at the most.
			expect(b.max.x - b.min.x).toBeLessThan(WATER_TILE_M + 2 * 160);
			expect(b.max.z - b.min.z).toBeLessThan(WATER_TILE_M + 2 * 160);
		}
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

	it('finds its shore where the drawn ground leaves the water', () => {
		const still = waterline.filter((p) => !p.running);
		expect(still.length).toBeGreaterThan(500);
		for (const p of still)
			expect(Math.abs(world.heightAt(p.x, p.z) - p.level)).toBeLessThan(0.01);
	});

	it('grows its reeds and lays its stones on the shore, never on a road', () => {
		const g = shoreDressing(
			route,
			waterline,
			world.clearOf,
			rideLook(() => '#808080').props,
		)!;
		const pos = g.getAttribute('position');
		expect(pos.count).toBeGreaterThan(300);
		for (let i = 0; i < pos.count; i += 7)
			expect(world.clearOf(pos.getX(i), pos.getZ(i), FORMATION + 1)).toBe(true);
	});
});

/**
 * Every stream and river on both lands, from its source down: unbroken to
 * the water it feeds or off the map, the drawn ground never standing over it,
 * and nothing standing in it.
 */
describe.each(['urnsee', 'valley'])('the water of %s’s land', (id) => {
	let world: World;
	let route: Route;
	beforeAll(async () => {
		const road = (await homeRoute(HOME_ROADS.find((r) => r.id === id)!)).road;
		route = routeOfRoad(road);
		world = generate(route);
	}, BUILD_MS);

	type Line = readonly (readonly [number, number])[];
	/** A stream's centre at cross-section i, and its half width there. */
	const mid = (w: Water, i: number) => {
		const o = w.outline;
		const [l, r] = [o[i], o[o.length - 1 - i]];
		return {
			x: (l[0] + r[0]) / 2,
			z: (l[1] + r[1]) / 2,
			half: Math.hypot(l[0] - r[0], l[1] - r[1]) / 2,
		};
	};
	/** Metres from (x, z) to a line. */
	const offLine = (pts: Line, x: number, z: number) => {
		let best = Infinity;
		for (let i = 0; i + 1 < pts.length; i++) {
			const [a, b] = [pts[i], pts[i + 1]];
			const sx = b[0] - a[0];
			const sz = b[1] - a[1];
			const t = Math.min(
				1,
				Math.max(
					0,
					((x - a[0]) * sx + (z - a[1]) * sz) / (sx * sx + sz * sz || 1),
				),
			);
			best = Math.min(best, Math.hypot(a[0] + sx * t - x, a[1] + sz * t - z));
		}
		return best;
	};
	const inside = (ring: Line, x: number, z: number) => {
		let k = false;
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const [xi, zi] = ring[i];
			const [xj, zj] = ring[j];
			if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
				k = !k;
		}
		return k;
	};
	/** Whether (x, z) lies in water `w`. */
	const isIn = (w: Water, x: number, z: number) => {
		if (w.run) {
			const line = w.run.levels.map(
				(_, i) => [mid(w, i).x, mid(w, i).z] as const,
			);
			return offLine(line, x, z) <= mid(w, 0).half + 0.5;
		}
		if (w.course) return offLine(w.course, x, z) <= mid(w, 0).half + 0.5;
		return (
			inside(w.outline, x, z) && !(w.islands ?? []).some((i) => inside(i, x, z))
		);
	};

	it('runs every stream into the water it feeds, or off the map', () => {
		const { west, east, south, north } = landOf(id)!.bounds;
		const streams = world.waters.filter((w) => w.run);
		expect(streams.length).toBeGreaterThan(id === 'valley' ? 2 : 12);
		const short: string[] = [];
		for (const w of streams) {
			const { x, z } = mid(w, w.run!.levels.length - 1);
			const [mx, my] = [x, -z];
			if (Math.min(mx - west, east - mx, my - south, north - my) < 30) continue;
			if (!world.waters.some((o) => o !== w && isIn(o, x, z)))
				short.push(`${Math.round(mx)}, ${Math.round(my)}`);
		}
		expect(short, 'streams ending short of any water').toEqual([]);
	});

	it('draws no ground over a stream from its source to its mouth, under its bridges too', () => {
		const gaps: string[] = [];
		for (const w of world.waters.filter((v) => v.run)) {
			const levels = w.run!.levels;
			levels.forEach((level, i) => {
				const { x, z } = mid(w, i);
				const over = world.groundAt(x, z) - level;
				if (over > 0.05)
					gaps.push(
						`${Math.round(x)}, ${Math.round(-z)}: ${over.toFixed(2)} m`,
					);
			});
		}
		expect(gaps, 'ground over running water').toEqual([]);
	});

	it(
		'stands nothing in the water: no tree, bush, cow or building',
		async () => {
			const { roadsidePlacer, BLOCK_M, ART } = await import('./roadside-place');
			const wet: string[] = [];
			const stood = world.everything;
			for (const p of [...stood.props, ...stood.pieces])
				if (wetWithin(world.waterAt, p.x, p.z, 0))
					wet.push(`${p.kind} at ${Math.round(p.x)}, ${Math.round(-p.z)}`);
			const placer = roadsidePlacer(route, world);
			for (let b = 0; b < Math.ceil(route.length / BLOCK_M); b++)
				for (const s of placer.spots(b))
					if (wetWithin(world.waterAt, s.x, s.z, 0))
						wet.push(
							`${ART[s.art].name} at ${Math.round(s.x)}, ${Math.round(-s.z)}`,
						);
			expect(stood.props.length).toBeGreaterThan(100);
			expect(wet, 'things standing in the water').toEqual([]);
		},
		BUILD_MS,
	);
});
