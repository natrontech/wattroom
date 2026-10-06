// @vitest-environment happy-dom
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { at } from '$lib/road/along';
import { toRoute, type Route } from '$lib/road/route';
import { RIDE } from './look.test-helper';
import { pageGrids } from './chunks/grids';
import { compose, type Composed } from './compose';
import { yOf } from './geometry';
import { syntheticPoints } from './synthetic';
import { REACH } from './terrain-mesh';
import { generate } from './world';
import { BUILD_MS } from './world.test-helper';

/**
 * The stage draws what the stream holds (#3606): as the eye rides on, a
 * chunk it first drew as a far quad is drawn again at the place's own level
 * once it comes within the near reach — the road's earthworks are cut into
 * that, and a far quad over them buries the road.
 */

let route: Route;
let w: Composed;
beforeAll(() => {
	route = toRoute(syntheticPoints());
	const world = generate(route);
	// The eye rides the whole loop: every tile it settles, settled up front (#3699).
	void world.everything;
	w = compose(
		{ route, world, style: RIDE, ftp: 250, grids: pageGrids(world) },
		null,
	);
}, BUILD_MS);

/** The far quads the terrain batch draws nearer the eye than `within` metres. */
function farQuadsWithin(within: number): number {
	let batch: THREE.BatchedMesh | null = null;
	w.scene.traverse((o) => {
		if (
			(o as THREE.BatchedMesh).isBatchedMesh &&
			o.userData.family === 'terrain'
		)
			batch = o as THREE.BatchedMesh;
	});
	const b = batch as THREE.BatchedMesh | null;
	if (!b) throw new Error('no streamed terrain');
	const eye = w.camera.position;
	const sphere = new THREE.Sphere();
	let n = 0;
	for (let i = 0; i < b.maxInstanceCount; i++) {
		let geo: number;
		try {
			if (!b.getVisibleAt(i)) continue;
			geo = b.getGeometryIdAt(i);
		} catch {
			continue;
		}
		if (b.getGeometryRangeAt(geo)!.vertexCount !== 4) continue;
		b.getBoundingSphereAt(geo, sphere);
		const d = Math.hypot(sphere.center.x - eye.x, sphere.center.z - eye.z);
		if (d + sphere.radius < within) n++;
	}
	return n;
}

describe('the stage', () => {
	it(
		'draws no far quad within the near reach, however far the eye has ridden',
		() => {
			for (let d = 0; d < route.length; d += 2000) {
				const p = at(route, d);
				w.camera.position.set(p.x, yOf(route, p.ele) + 3, p.z);
				w.look();
				expect(farQuadsWithin(REACH.near - 200), `${d} m`).toBe(0);
			}
		},
		BUILD_MS,
	);
});
