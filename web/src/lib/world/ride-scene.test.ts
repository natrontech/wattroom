// @vitest-environment happy-dom
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { at, leftOf } from '$lib/road/along';
import { legsRoad } from '$lib/road/fixtures';
import { RIDER_BOX } from '$lib/session/docks';
import { RIDE } from './look.test-helper';
import { compose } from './compose';
import { routeOfRoad } from './road-route';
import type { Hud } from './compose';
import type { RideMetre } from './sim';
import { ROAD_W } from './terrain/road-profile';
import { generate, type World } from './world';
import { BUILD_MS } from './world.test-helper';
import type { Route } from '$lib/road/route';

/**
 * A ride's world is this ride (#3663): one figure, yours, standing where the
 * ride says you are on its road — the world moves nobody of its own.
 */

const style = RIDE;
let route: Route;
let world: World;
beforeAll(() => {
	route = routeOfRoad(legsRoad([1500, 2], [1500, 6], [1000, 0]));
	world = generate(route);
}, BUILD_MS);

const figures = (scene: THREE.Scene) => {
	let n = 0;
	scene.traverse((o) => {
		if (o.userData.family === 'figures') n++;
	});
	return n;
};

describe('a ride’s world', () => {
	it('holds one figure on a solo ride, yours', () => {
		const w = compose(
			{ route, world, style, ftp: 250, metre: () => ({ m: 0, mps: 0 }) },
			null,
		);
		expect(figures(w.scene)).toBe(1);
		w.dispose();
	});

	it('keeps you, riding alone, in the middle of the right lane', () => {
		const w = compose(
			{ route, world, style, ftp: 250, metre: () => ({ m: 1200, mps: 0 }) },
			null,
		);
		w.advanceBy(0.3);
		let you: THREE.Object3D | undefined;
		w.scene.traverse((o) => {
			if (!you && o.userData.family === 'figures') you = o;
		});
		const pos = you!.getWorldPosition(new THREE.Vector3());
		const p = at(route, 1200);
		const { lx, lz } = leftOf(p.heading);
		// Left of the road's centre is positive: the right lane's middle is a quarter of the road to the right.
		expect((pos.x - p.x) * lx + (pos.z - p.z) * lz).toBeCloseTo(-ROAD_W / 4, 1);
		// The chase eye rides your lane, so the lane leaves you inside RIDER_BOX (40–60 % across).
		w.camera.aspect = 1440 / 900;
		w.camera.updateProjectionMatrix();
		w.advanceBy(0.3);
		w.camera.updateMatrixWorld();
		const across = you!
			.getWorldPosition(new THREE.Vector3())
			.project(w.camera).x;
		expect((across + 1) / 2).toBeGreaterThan(RIDER_BOX.x0);
		expect((across + 1) / 2).toBeLessThan(RIDER_BOX.x1);
		w.dispose();
	});

	it('stands your figure on the ride’s metre, and follows it as the ride moves', () => {
		const ride: RideMetre = { m: 1200, mps: 0 };
		let km = NaN;
		const w = compose(
			{
				route,
				world,
				style,
				ftp: 250,
				metre: () => ride,
				onTick: (hud) => (km = hud.km),
			},
			null,
		);
		w.advanceBy(0.3);
		expect(km * 1000).toBeCloseTo(1200, 0);
		// A second at 8 m/s: the figure rolls on at the ride's speed, then settles on its next metre.
		ride.mps = 8;
		for (let f = 0; f < 30; f++) w.advanceBy(1 / 30);
		ride.m = 1208;
		for (let f = 0; f < 30; f++) w.advanceBy(1 / 30);
		expect(km * 1000).toBeGreaterThan(1208);
		expect(km * 1000).toBeLessThan(1208 + 8 + 0.5);
		// Its own watts move nothing: the world tells the ride nothing and rides no pace of its own.
		ride.mps = 0;
		w.setWatts(600);
		for (let f = 0; f < 90; f++) w.advanceBy(1 / 30);
		expect(km * 1000).toBeCloseTo(1208, 0);
		w.dispose();
	});

	it('draws your trail as a thin line on the road behind you, never a wall', () => {
		const ride: RideMetre = { m: 900, mps: 0 };
		const w = compose(
			{ route, world, style, ftp: 250, metre: () => ride },
			null,
		);
		w.advanceBy(0.3);
		let trail: THREE.Mesh | null = null;
		w.scene.traverse((o) => {
			if (o.userData.kind === 'trail') trail = o as THREE.Mesh;
		});
		const pos = (trail as THREE.Mesh | null)!.geometry.attributes.position;
		const at = (k: number) => new THREE.Vector3().fromBufferAttribute(pos, k);
		// Each row is a pair across the line, a wheel wide, level with each other.
		for (let k = 0; k < pos.count; k += 2) {
			expect(at(k).distanceTo(at(k + 1))).toBeCloseTo(0.08, 3);
			expect(Math.abs(at(k).y - at(k + 1).y)).toBeLessThan(1e-6);
		}
		// It lies along three metres of road behind the wheel: its fade ends inside the chase frame.
		const [first, last] = [at(0), at(pos.count - 2)];
		expect(Math.hypot(first.x - last.x, first.z - last.z)).toBeGreaterThan(2.7);
		expect(Math.hypot(first.x - last.x, first.z - last.z)).toBeLessThan(3.1);
		w.dispose();
	});

	it('lays a bunch out by the wall’s time, however slowly its frames come (#3098)', () => {
		const where = (frame: number, wall: number) => {
			let tick = { m: 300, s: 0 };
			let hud: Hud | null = null;
			const w = compose(
				{
					route,
					world,
					style,
					ftp: 250,
					youId: 'a',
					metre: () => ({ m: tick.m, mps: 8 }),
					bunch: () => ({
						m: tick.m,
						mps: 8,
						elapsed: 30,
						order: ['a', 'b', 'c', 'd'],
						// b is towed back in, two metres a second: an offset on the move.
						offsets: { b: -40 + 2 * tick.s },
						resting: [],
						present: new Map(
							['a', 'b', 'c', 'd'].map((id) => [id, { watts: 200, ftp: 250 }]),
						),
						game: false,
					}),
					onTick: (next) => (hud = next),
				},
				null,
			);
			// Six seconds of the hub's whole-second ticks, drawn at this screen's frame rate.
			for (let t = 0; t < 6; t += wall) {
				if (Math.floor(t + wall) > Math.floor(t))
					tick = { m: tick.m + 8, s: tick.s + 1 };
				w.advanceBy(frame, wall);
			}
			w.dispose();
			return hud!.riders;
		};
		const fast = where(1 / 30, 1 / 30);
		// A screen drawing twice a second: each frame clamped to 0.1 s, as scene.ts clamps it.
		const slow = where(0.1, 0.5);
		// The two snapshots are taken a moment apart: compare where each rider is against the first.
		const gap = (list: Hud['riders'], id: string) =>
			list.find((x) => x.id === id)!.d - list.find((x) => x.id === 'a')!.d;
		for (const r of fast) {
			const s = slow.find((x) => x.id === r.id)!;
			expect(
				Math.abs(gap(slow, r.id) - gap(fast, r.id)),
				`${r.id} along the road`,
			).toBeLessThan(1);
			expect(Math.abs(s.lane - r.lane), `${r.id} across it`).toBeLessThan(0.1);
		}
	});
});
