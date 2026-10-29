// @vitest-environment happy-dom
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { at } from '$lib/road/along';
import { hairpinsOf } from '$lib/road/climbs';
import { hairpinClimb } from '$lib/road/fixtures';
import { toRoute, type Route } from '$lib/road/route';
import { pageGrids } from './chunks/grids';
import type { Composed } from './compose';
import type { Family } from './family';
import { yOf } from './geometry';
import { RIDE } from './look.test-helper';
import { figureBox, HELMET_M, LENS, TYRE_M } from './picture-camera';
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

/**
 * Your figure on the frame, as shares of it from the top left: how far
 * across its box's middle stands, and from the tyres' contact to the
 * helmet's top, how high it is and where its middle falls, as a reader of
 * the picture would measure them.
 */
function onFrame(still: Composed) {
	const box = figureBox(still.you!);
	const v = new THREE.Vector3();
	let [y0, y1] = [Infinity, -Infinity];
	still.you!.traverse((o) => {
		if (!(o as THREE.Bone).isBone) return;
		const lift = o.name.endsWith('Wheel')
			? -TYRE_M
			: o.name === 'head'
				? HELMET_M
				: 0;
		o.getWorldPosition(v)
			.setY(v.y + lift)
			.project(still.camera);
		y0 = Math.min(y0, (1 - v.y) / 2);
		y1 = Math.max(y1, (1 - v.y) / 2);
	});
	box.getCenter(v).project(still.camera);
	return { box, x: (v.x + 1) / 2, y: (y0 + y1) / 2, h: y1 - y0 };
}

/** The ground or dressing the frame's top edge meets within `m` metres: none, where it shows the sky past you. */
function topEdge(still: Composed, m: number) {
	const solid: THREE.Object3D[] = [];
	still.scene.traverseVisible((o) => {
		const family = familyOf(o);
		if (
			(family === 'terrain' || family === 'dressing') &&
			(o as THREE.Mesh).isMesh
		)
			solid.push(o);
	});
	const ray = new THREE.Raycaster();
	ray.far = m;
	const hits: string[] = [];
	for (const x of [-0.6, 0, 0.6]) {
		ray.setFromCamera(new THREE.Vector2(x, 0.95), still.camera);
		for (const hit of ray.intersectObjects(solid, false))
			hits.push(
				`${familyOf(hit.object)} at ${hit.distance.toFixed(0)} m, x ${x}`,
			);
	}
	return hits;
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

/**
 * The sky's peach band on the frame, over 36 columns across it: how many
 * show it, where the band's top, as the sky's shader reads it at that
 * column's bearing, stands inside the frame with nothing solid before it;
 * and the most of the frame's height it shows in any, from that top down
 * to the first thing solid under it.
 */
function bandOnFrame(still: Composed) {
	const camera = still.camera;
	camera.updateMatrixWorld();
	const skies: THREE.ShaderMaterial[] = [];
	const solid: THREE.Object3D[] = [];
	still.scene.traverseVisible((o) => {
		const mesh = o as THREE.Mesh;
		if (!mesh.isMesh || (o as THREE.SkinnedMesh).isSkinnedMesh) return;
		const material = mesh.material as THREE.ShaderMaterial;
		if (material.uniforms?.uSkyline) skies.push(material);
		else solid.push(o);
	});
	const [sky] = skies;
	expect(sky.uniforms.uPeach.value).toBeGreaterThan(0.9);
	const crests = (sky.uniforms.uSkyline.value as THREE.DataTexture).image
		.data as Uint8Array;
	const n = crests.length;
	const ray = new THREE.Raycaster();
	const dir = new THREE.Vector3();
	let columns = 0;
	let tallest = 0;
	for (let c = 0; c < 36; c++) {
		const x = (c + 0.5) / 18 - 1;
		ray.setFromCamera(new THREE.Vector2(x, 0), camera);
		const a = Math.atan2(ray.ray.direction.x, ray.ray.direction.z);
		const i = Math.floor(((((a / (Math.PI * 2)) % 1) + 1) % 1) * n) % n;
		// A byte's 0–1 is a sine of 0–0.25; just under the top, the band is whole.
		const top = (crests[i] / 255) * 0.25 - 0.002;
		const flat = Math.sqrt(1 - top * top);
		dir.set(Math.sin(a) * flat, top, Math.cos(a) * flat);
		const from = camera.position.clone().add(dir).project(camera).y;
		if (Math.abs(from) > 1) continue;
		ray.set(camera.position, dir);
		if (ray.intersectObjects(solid, false).length > 0) continue;
		columns++;
		// Down the column from the band's top, a 270th of the frame a step, to what stands under it.
		let y = from;
		for (; y > -1; y -= 2 / 270) {
			ray.setFromCamera(new THREE.Vector2(x, y), camera);
			if (ray.intersectObjects(solid, false).length > 0) break;
		}
		tallest = Math.max(tallest, (from - y) / 2);
	}
	return { columns, tallest };
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
				expect(h, what).toBeGreaterThan(0.36);
				expect(h, what).toBeLessThan(0.46);
				// On a third across, a little under the middle.
				const third = Math.min(Math.abs(x - 1 / 3), Math.abs(x - 2 / 3));
				expect(third, what).toBeLessThan(0.03);
				// Your middle from the tyres to the helmet, as SPEC has it: 0.01 is 13 px of 1,350 (#4278).
				expect(Math.abs(y - LENS.down), what).toBeLessThan(0.01);
				// Low: knee height over the road, under the chase camera's 2.4 m.
				const { x: cx, z: cz } = still.camera.position;
				const under = world.roadSurfaceAt(cx, cz) ?? world.heightAt(cx, cz);
				expect(still.camera.position.y - yOf(route, under), what).toBeLessThan(
					1.4,
				);
				// Past you the picture opens onto the sky: no slope or tree across the frame's top.
				expect(topEdge(still, 300), what).toEqual([]);
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

	it(
		'shows the peach band past you where the slope you climb stands over the far ranges (#4278)',
		() => {
			const climb = toRoute(hairpinClimb());
			const land = generate(climb);
			const pins = hairpinsOf(climb.road);
			// Low on the climb, the hillside past you stands over the far ranges.
			const still = pictureStill(
				{
					route: climb,
					world: land,
					style: RIDE,
					ftp: 250,
					grids: pageGrids(land),
				},
				{ m: pins[3], p: 0, watts: 200 },
			);
			const band = bandOnFrame(still);
			// Across most of the frame, the alpenglow clears the land past you…
			expect(band.columns).toBeGreaterThanOrEqual(24);
			// …and stays a band over it, never a wall of peach: 8 % is 108 px of 1,350.
			expect(band.tallest).toBeLessThan(0.08);
			still.dispose();
		},
		2 * BUILD_MS,
	);
});
