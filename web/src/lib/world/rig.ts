// The camera rides the road: its eye is a point on the route behind you, its
// gaze a point ahead, each on an exponential follow with its own half-life.
// It never looks along a single segment's heading, so bends sweep instead
// of snapping, and it never goes below the ground.
import * as THREE from 'three';
import { damp } from '$lib/motion/damp';
import { yOf } from './geometry';
import { type Route } from '$lib/road/route';
import { at, leftOf } from '$lib/road/along';
import type { SimRider } from './sim';
import type { World } from './world';

/** chase and heli follow you; side stands off your right shoulder, a held moment's view of the figure and bike. */
export type Follow = 'chase' | 'heli' | 'side';

/** The side view: metres out to your right, ahead, and up; a three-quarter front, so the face, the drops and both wheels show. */
const SIDE = { out: 3.2, ahead: 1.6, up: 0.3, fov: 40 };

const EYE_FLOOR = 1.5; // metres the eye keeps above the drawn ground
const GOAL_FLOOR = 1.8;

/**
 * The route `d` metres along; off either end of a road that is not a loop,
 * straight on from that end — at a ride's first metre the eye stands
 * behind you, not on you (#3663).
 */
function along(route: Route, d: number) {
	if (route.loop || (d >= 0 && d <= route.length)) return at(route, d);
	const end = d < 0 ? 0 : route.length;
	const p = at(route, end);
	return {
		...p,
		x: p.x + Math.sin(p.heading) * (d - end),
		z: p.z + Math.cos(p.heading) * (d - end),
	};
}

export function makeRig(route: Route, world: World) {
	const eye = new THREE.Vector3();
	const gaze = new THREE.Vector3();
	const want = new THREE.Vector3();
	const look = new THREE.Vector3();
	let started = false;
	const ground = (x: number, z: number) => yOf(route, world.heightAt(x, z));

	return {
		// Snap on the next update instead of easing in from wherever it was.
		reset() {
			started = false;
		},
		update(
			camera: THREE.PerspectiveCamera,
			mode: Follow,
			rider: SimRider,
			you: THREE.Vector3,
			real: number,
		) {
			if (mode === 'side') {
				const p = along(route, rider.d);
				const { lx, lz } = leftOf(p.heading);
				camera.position.set(
					you.x - lx * SIDE.out + Math.sin(p.heading) * SIDE.ahead,
					you.y + SIDE.up,
					you.z - lz * SIDE.out + Math.cos(p.heading) * SIDE.ahead,
				);
				camera.lookAt(you);
				camera.fov = SIDE.fov;
				camera.updateProjectionMatrix();
				started = false;
				return;
			}
			const chase = mode === 'chase';
			const back = chase ? 6.5 + Math.min(3, rider.v * 0.15) : 70;
			// The eye rides your lane, not the centre line, so your lane leaves you in RIDER_BOX.
			const c = along(route, rider.d);
			const sx = you.x - c.x;
			const sz = you.z - c.z;
			const b = along(route, rider.d - back);
			want.set(b.x + sx, yOf(route, b.ele) + (chase ? 2.4 : 42), b.z + sz);
			want.y = Math.max(want.y, ground(want.x, want.z) + GOAL_FLOOR);
			const a = along(route, rider.d + (chase ? 18 : 10));
			look
				.set(a.x + sx, yOf(route, a.ele) + 1.0, a.z + sz)
				.lerp(you, chase ? 0.45 : 0.8);
			const kmh = rider.v * 3.6;
			const fov = chase ? 50 + Math.min(10, Math.max(0, kmh - 20) * 0.25) : 45;
			if (!started) {
				eye.copy(want);
				gaze.copy(look);
				camera.fov = fov;
				camera.updateProjectionMatrix();
				started = true;
			}
			eye.lerp(want, damp(chase ? 0.22 : 0.6, real));
			gaze.lerp(look, damp(0.12, real));
			// The goal clears the ground; the eased eye can still cut a crest.
			eye.y = Math.max(eye.y, ground(eye.x, eye.z) + EYE_FLOOR);
			camera.position.copy(eye);
			camera.lookAt(gaze);
			if (Math.abs(camera.fov - fov) > 0.05) {
				camera.fov += (fov - camera.fov) * damp(0.5, real);
				camera.updateProjectionMatrix();
			}
		},
	};
}
