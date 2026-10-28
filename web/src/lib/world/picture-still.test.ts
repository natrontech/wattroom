// @vitest-environment happy-dom
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { at } from '$lib/road/along';
import { hairpinsOf } from '$lib/road/climbs';
import { toRoute, type Route } from '$lib/road/route';
import { pageGrids } from './chunks/grids';
import type { Composed } from './compose';
import type { Family } from './family';
import { yOf } from './geometry';
import { RIDE } from './look.test-helper';
import { figureBox, LENS } from './picture-camera';
import { pictureStill } from './picture-still';
import { syntheticPoints } from './synthetic';
import { generate, type World } from './world';
import { BUILD_MS } from './world.test-helper';

/**
 * The ride's picture is composed (#4263): drawn again at its moment with its
 * own camera, low and at a front three-quarter, you large on a third of the
 * portrait frame, and nothing of the dressing between the lens and you.
 */

let route: Route;
let world: World;
beforeAll(() => {
	route = toRoute(syntheticPoints());
	world = generate(route);
}, BUILD_MS);

function familyOf(o: THREE.Object3D): Family | null {
	for (let p: THREE.Object3D | null = o; p; p = p.parent)
		if (p.userData.family) return p.userData.family as Family;
	return null;
}

/** Your figure's box on the frame, as shares of it from the top left. */
function onFrame(still: Composed) {
	const box = figureBox(still.you!);
	const v = new THREE.Vector3();
	let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
	for (const x of [box.min.x, box.max.x])
		for (const y of [box.min.y, box.max.y])
			for (const z of [box.min.z, box.max.z]) {
				v.set(x, y, z).project(still.camera);
				x0 = Math.min(x0, (v.x + 1) / 2);
				x1 = Math.max(x1, (v.x + 1) / 2);
				y0 = Math.min(y0, (1 - v.y) / 2);
				y1 = Math.max(y1, (1 - v.y) / 2);
			}
	return { box, x: (x0 + x1) / 2, y: (y0 + y1) / 2, h: y1 - y0 };
}

/** The dressing a ray from the lens meets before it reaches each corner and the middle of your figure. */
function inTheWay(still: Composed, box: THREE.Box3) {
	const dressing: THREE.Object3D[] = [];
	still.scene.traverseVisible((o) => {
		if (familyOf(o) === 'dressing' && (o as THREE.Mesh).isMesh)
			dressing.push(o);
	});
	const eye = still.camera.position;
	const points = [box.getCenter(new THREE.Vector3())];
	for (const x of [box.min.x, box.max.x])
		for (const y of [box.min.y + 0.3, box.max.y])
			for (const z of [box.min.z, box.max.z])
				points.push(new THREE.Vector3(x, y, z));
	const ray = new THREE.Raycaster();
	const hits: string[] = [];
	for (const p of points) {
		const dir = p.clone().sub(eye);
		ray.set(eye, dir.clone().normalize());
		ray.far = dir.length();
		for (const hit of ray.intersectObjects(dressing, false))
			hits.push(
				`${hit.object.userData.kind ?? hit.object.type} ${hit.distance.toFixed(1)} m`,
			);
	}
	return { hits, dressing: dressing.length };
}

describe('the ride’s picture of the world (#4263)', () => {
	const moments = () => {
		const top = route.climbs.reduce((a, b) =>
			at(route, b.topM).ele > at(route, a.topM).ele ? b : a,
		);
		return [
			['a summit', top.topM - 20],
			['a hairpin', hairpinsOf(route.road)[0]],
		] as const;
	};

	it(
		'frames you alone, large on a third from low, with nothing of the dressing in the way',
		() => {
			for (const [what, m] of moments()) {
				const still = pictureStill(
					{ route, world, style: RIDE, ftp: 250, grids: pageGrids(world) },
					{ m, p: 0, watts: 200 },
				);
				const { box, x, y, h } = onFrame(still);
				// Large: about two fifths of the frame's height, never a figure in the distance.
				expect(h, what).toBeGreaterThan(0.33);
				expect(h, what).toBeLessThan(0.55);
				// On a third across, a little under the middle.
				const third = Math.min(Math.abs(x - 1 / 3), Math.abs(x - 2 / 3));
				expect(third, what).toBeLessThan(0.03);
				expect(Math.abs(y - LENS.down), what).toBeLessThan(0.03);
				// Low: knee height over the road, under the chase camera's 2.4 m.
				const road = yOf(route, at(route, m + LENS.ahead).ele);
				expect(still.camera.position.y - road, what).toBeLessThan(1.4);
				// You alone on the road: one figure, whoever rode beside you.
				let figures = 0;
				still.scene.traverse((o) => {
					if ((o as THREE.SkinnedMesh).isSkinnedMesh) figures++;
				});
				expect(figures, what).toBe(1);
				// The dressing stands within reach, and none of it between the lens and you.
				const seen = inTheWay(still, box);
				expect(seen.dressing, what).toBeGreaterThan(0);
				expect(seen.hits, what).toEqual([]);
				still.dispose();
			}
		},
		2 * BUILD_MS,
	);
});
