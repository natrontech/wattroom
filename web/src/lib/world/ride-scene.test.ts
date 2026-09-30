// @vitest-environment happy-dom
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { legsRoad } from '$lib/road/fixtures';
import { STYLES } from '../../routes/(app)/dev/world/styles';
import { compose } from './compose';
import { routeOfRoad } from './road-route';
import type { RideMetre } from './sim';
import { generate, type World } from './world';
import { BUILD_MS } from './world.test-helper';
import type { Route } from '$lib/road/route';

/**
 * A ride's world is this ride (#3663): one figure, yours, standing where the
 * ride says you are on its road — the world moves nobody of its own.
 */

const style = STYLES.find((s) => s.id === 'bluehour') ?? STYLES[0];
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
		// It lies along twelve metres of road behind the wheel.
		const [first, last] = [at(0), at(pos.count - 2)];
		expect(Math.hypot(first.x - last.x, first.z - last.z)).toBeGreaterThan(11);
		expect(Math.hypot(first.x - last.x, first.z - last.z)).toBeLessThan(12.1);
		w.dispose();
	});
});
