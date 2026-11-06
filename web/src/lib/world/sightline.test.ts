// @vitest-environment happy-dom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { at, leftOf } from '$lib/road/along';
import { toRoute } from '$lib/road/route';
import { CAMERA } from './camera';
import { CAMERA_PRESETS } from './cameras';
import { ROAD_LIFT, yOf } from './geometry';
import { sightKeep } from './materials';
import { makeRig } from './rig';
import type { SimRider } from './sim';
import { syntheticPoints } from './synthetic';
import { ROAD_W } from './terrain/road-profile';
import type { World } from './world';

/**
 * The dressing's sightline fade (#3220 O7) dithers away what stands between
 * the camera and you, so nothing hides you. It measured to the nearest point
 * of the camera→you segment, which past you is you yourself, so it faded a
 * ball round you too: a danger sign or a snow pole at the verge, 3 m off your
 * line, dissolved from 5 m before you reached it (#4424). Trees stand farther
 * out and never met it.
 */

const route = toRoute(syntheticPoints());
const rig = makeRig(route, {
	heightAt: () => 0,
	markers: [],
} as unknown as World);
const camera = new THREE.PerspectiveCamera(50, 16 / 9, CAMERA.near, CAMERA.far);
const rider = { d: 0, v: 8 } as SimRider;
/** Where the shader's you is: your lane, over the road, at the figure's middle (crew.ts). */
const you = new THREE.Vector3();
const LANE = -ROAD_W / 4;
/** Where a danger sign stands for your way's riders: on your right, its post this far from the centre line (setpieces-stroke.ts). */
const SIGN_OFF = 4.6;
/** A fragment the Bayer dither never drops. */
const WHOLE = 15.5 / 16;
/** Inside this the lens itself is in the sign: O7 fades it in any camera. */
const AT_LENS_M = 3;

/** Puts the camera where `mode` holds it with you at `d`, settled. */
function ride(mode: (typeof CAMERA_PRESETS)[number], d: number) {
	const p = at(route, d);
	const { lx, lz } = leftOf(p.heading);
	you.set(
		p.x + lx * LANE,
		yOf(route, p.ele) + ROAD_LIFT + 1.1,
		p.z + lz * LANE,
	);
	rider.d = d;
	rig.reset();
	rig.update(camera, mode, rider, you, 1);
	camera.updateMatrixWorld();
}

/** A danger sign's post and face at `d`, as points from its foot to its top and across its face. */
function sign(d: number): THREE.Vector3[] {
	const s = at(route, d);
	const { lx, lz } = leftOf(s.heading);
	const out: THREE.Vector3[] = [];
	for (let h = 0.3; h <= 2.7; h += 0.3)
		for (const across of [-0.6, 0, 0.6])
			out.push(
				new THREE.Vector3(
					s.x - lx * (SIGN_OFF + across),
					yOf(route, s.ele) + h,
					s.z - lz * (SIGN_OFF + across),
				),
			);
	return out;
}

describe('the sightline fade', () => {
	it.each(CAMERA_PRESETS)(
		'leaves a sign at the verge whole until you are within 1.5 m of it, in the %s camera',
		(mode) => {
			const frustum = new THREE.Frustum();
			const faded: string[] = [];
			// Every 700 m of the loop: straights, its bends and its hairpins.
			for (let d0 = 1000; d0 < route.length - 1000; d0 += 700) {
				const board = sign(d0);
				for (let ahead = 30; ahead >= 1.5; ahead -= 0.5) {
					ride(mode, d0 - ahead);
					frustum.setFromProjectionMatrix(
						new THREE.Matrix4().multiplyMatrices(
							camera.projectionMatrix,
							camera.matrixWorldInverse,
						),
					);
					const lost = board.filter(
						(q) =>
							frustum.containsPoint(q) &&
							q.distanceTo(camera.position) > AT_LENS_M &&
							sightKeep(q, camera.position, you) < WHOLE,
					);
					if (lost.length) faded.push(`${d0} m, ${ahead} m ahead`);
				}
			}
			expect(faded).toEqual([]);
		},
	);

	it.each(CAMERA_PRESETS)(
		'still fades what stands between the %s camera and you, or right beside you',
		(mode) => {
			for (let d = 1000; d < route.length - 1000; d += 700) {
				ride(mode, d);
				const cam = camera.position;
				const between = cam.clone().lerp(you, 0.5);
				// 2 m to your side, square to the way the camera looks: it can cover your figure.
				const look = new THREE.Vector3(you.x - cam.x, 0, you.z - cam.z);
				const side = new THREE.Vector3(-look.z, 0, look.x).setLength(2);
				const gone = 0.5 / 16; // under the dither's lowest step: not drawn at all
				expect(sightKeep(between, cam, you), `${d} m`).toBeLessThan(gone);
				for (const beside of [you.clone().add(side), you.clone().sub(side)])
					expect(sightKeep(beside, cam, you), `${d} m`).toBeLessThan(gone);
			}
		},
	);
});
