// @vitest-environment happy-dom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HOME_ROADS, homeRoute } from '$lib/ride/home-roads';
import { compose } from './compose';
import { RIDE } from './look.test-helper';
import { routeOfRoad } from './road-route';
import { generate } from './world';
import { BUILD_MS } from './world.test-helper';

/**
 * A loop is dressed all the way round (#4260). A ride starts partway round,
 * as a workout starts where its terrain matches, and rides a whole lap
 * through the start line. In every 100 m of it the renderer draws dressing
 * ahead of the eye. The dressing's tiles stream in and out round the eye
 * (#3699), so a batch the renderer culls whole, by bounds it measured on the
 * first frame, takes every tree, house and cow with it until the eye looks
 * back at where the ride began.
 */

const BIN_M = 100;
/** How far ahead of the eye a bin's dressing counts. */
const AHEAD_M = 400;

/** Whether the renderer draws any dressing in view within AHEAD_M of the eye, culling as three does: each batch whole, then each instance. */
function drawsAny(batches: THREE.BatchedMesh[], camera: THREE.Camera): boolean {
	camera.updateMatrixWorld();
	const frustum = new THREE.Frustum().setFromProjectionMatrix(
		new THREE.Matrix4().multiplyMatrices(
			camera.projectionMatrix,
			camera.matrixWorldInverse,
		),
	);
	const m = new THREE.Matrix4();
	const at = new THREE.Vector3();
	for (const b of batches) {
		if (b.frustumCulled && !b.intersectsFrustum(frustum)) continue;
		for (let i = 0; i < b.maxInstanceCount; i++) {
			try {
				if (!b.getVisibleAt(i)) continue;
				b.getMatrixAt(i, m);
			} catch {
				continue; // a deleted instance
			}
			at.setFromMatrixPosition(m);
			if (at.distanceTo(camera.position) < AHEAD_M && frustum.containsPoint(at))
				return true;
		}
	}
	return false;
}

describe('a WattRoom loop’s dressing', () => {
	it.each(HOME_ROADS)(
		'$name is drawn in every 100 m of a lap, through the start line',
		async (home) => {
			const route = routeOfRoad((await homeRoute(home)).road);
			const world = generate(route);
			const L = route.length;
			let m = Math.round(L / 3);
			const w = compose(
				{
					route,
					world,
					style: RIDE,
					ftp: 250,
					// The ground is not under test: no chunk is ever built for it.
					grids: () => ({ ask() {}, dispose() {} }),
					metre: () => ({ m: m % L, mps: 10 }),
				},
				null,
			);
			w.camera.aspect = 16 / 9;
			w.camera.updateProjectionMatrix();
			const batches: THREE.BatchedMesh[] = [];
			w.scene.traverse((o) => {
				if (
					(o as THREE.BatchedMesh).isBatchedMesh &&
					o.userData.family === 'dressing'
				)
					batches.push(o as THREE.BatchedMesh);
			});
			const bare: number[] = [];
			for (const end = m + L; m < end; m += BIN_M) {
				w.advanceBy(1);
				if (!drawsAny(batches, w.camera)) bare.push(m % L);
			}
			expect(bare, 'lap metres with no dressing drawn').toEqual([]);
		},
		BUILD_MS,
	);
});
