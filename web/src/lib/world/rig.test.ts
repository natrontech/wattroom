import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { at, leftOf } from '$lib/road/along';
import { toRoute } from '$lib/road/route';
import { makeRig } from './rig';
import { syntheticPoints } from './synthetic';
import type { SimRider } from './sim';
import type { World } from './world';

describe('chase camera', () => {
	it('never widens the field of view more than 4° over its base (ADR-0079)', () => {
		const route = toRoute(syntheticPoints());
		const rig = makeRig(route, {
			heightAt: () => 0,
			markers: [],
		} as unknown as World);
		const camera = new THREE.PerspectiveCamera(50, 1.6);
		const rider = { d: 500, v: 25 } as SimRider;
		for (let k = 0; k < 600; k++)
			rig.update(camera, 'chase', rider, new THREE.Vector3(), 1 / 30);
		expect(camera.fov).toBeLessThanOrEqual(54 + 1e-6);
		expect(camera.fov).toBeGreaterThan(53);
	});
});

describe('side view (#4261)', () => {
	it('stands off your right shoulder and ahead of you, the way you ride', () => {
		const route = toRoute(syntheticPoints());
		const rig = makeRig(route, {
			heightAt: () => 0,
			markers: [],
		} as unknown as World);
		const camera = new THREE.PerspectiveCamera(50, 1.6);
		for (const reverse of [false, true]) {
			const rider = { d: 500, v: 8, reverse } as SimRider;
			const p = at(route, rider.d);
			const you = new THREE.Vector3(p.x, 1, p.z);
			rig.update(camera, 'side', rider, you, 1 / 30);
			const way = reverse ? -1 : 1;
			const { lx, lz } = leftOf(p.heading);
			const dx = camera.position.x - you.x;
			const dz = camera.position.z - you.z;
			const ahead = (dx * Math.sin(p.heading) + dz * Math.cos(p.heading)) * way;
			const left = (dx * lx + dz * lz) * way;
			expect(ahead, `ahead, reverse ${reverse}`).toBeGreaterThan(1);
			expect(left, `left, reverse ${reverse}`).toBeLessThan(-3);
		}
	});
});
