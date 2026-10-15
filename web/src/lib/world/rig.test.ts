import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { toRoute } from '$lib/road/route';
import { makeRig } from './rig';
import { syntheticPoints } from './synthetic';
import type { SimRider } from './sim';
import type { World } from './world';

describe('chase camera', () => {
	it('never widens the field of view more than 4° over its base (ADR-0079)', () => {
		const route = toRoute(syntheticPoints());
		const rig = makeRig(route, { heightAt: () => 0 } as unknown as World);
		const camera = new THREE.PerspectiveCamera(50, 1.6);
		const rider = { d: 500, v: 25 } as SimRider;
		for (let k = 0; k < 600; k++)
			rig.update(camera, 'chase', rider, new THREE.Vector3(), 1 / 30);
		expect(camera.fov).toBeLessThanOrEqual(54 + 1e-6);
		expect(camera.fov).toBeGreaterThan(53);
	});
});
