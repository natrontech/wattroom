// @vitest-environment happy-dom
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { toRoute, type Route } from '$lib/road/route';
import { STYLES } from '../../routes/(app)/dev/world/styles';
import { compose, type Composed } from './compose';
import { syntheticPoints } from './synthetic';
import { generate, type World } from './world';
import { BUILD_MS } from './world.test-helper';

/**
 * A moment of the world is one frame (#3672): two loads of it draw the same
 * scene, and a held moment moves with nothing — not the clock, not the sim,
 * not the wind — so a design capture compares like with like.
 */

const style = STYLES.find((s) => s.id === 'bluehour') ?? STYLES[0];
let route: Route;
let world: World;
beforeAll(() => {
	route = toRoute(syntheticPoints());
	world = generate(route);
}, BUILD_MS);

/** Everything a frame of `w` is drawn from that could move: the camera, every figure and bone, the wind. */
function frame(w: Composed): number[] {
	w.scene.updateMatrixWorld(true);
	w.camera.updateMatrixWorld();
	const out = [...w.camera.matrixWorld.elements];
	w.scene.traverse((o) => {
		if (o.userData.family === 'figures') {
			out.push(...o.matrixWorld.elements);
			const skinned = o as THREE.SkinnedMesh;
			if (skinned.isSkinnedMesh)
				for (const bone of skinned.skeleton.bones)
					out.push(...bone.quaternion.toArray());
		}
		const mat = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
		const time = mat?.uniforms?.uTime?.value;
		if (typeof time === 'number') out.push(time);
	});
	return out;
}

const moment = { m: 1200, p: 0 };
const at = () =>
	compose({ route, world, style, ftp: 250, watts: 220, moment }, null);

describe('a moment of the world', () => {
	it('is one frame, however often it is drawn', () => {
		const a = at();
		const b = at();
		a.advanceBy(0.4);
		b.advanceBy(1 / 30);
		expect(frame(a)).toEqual(frame(b));
		a.dispose();
		b.dispose();
	});

	it('holds while the clock runs', () => {
		const w = at();
		const still = frame(w);
		for (let k = 0; k < 60; k++) w.advanceBy(1 / 30);
		expect(frame(w)).toEqual(still);
		expect(w.idle()).toBe(true);
		w.dispose();
	});

	it('stands you on its metre, and reports what a capture measures', () => {
		let km = NaN;
		const w = compose(
			{ route, world, style, ftp: 250, moment, onTick: (h) => (km = h.km) },
			null,
		);
		expect(km).toBeCloseTo(1.2, 6);
		const probe = w.probe();
		expect(probe.moment).toEqual(moment);
		expect(probe.camera.fov).toBeGreaterThan(40);
		expect(probe.figure.bboxH).toBeGreaterThan(0.05);
		expect(probe.figure.bboxH).toBeLessThan(1);
		w.dispose();
	});
});
