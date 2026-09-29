// The camera rides the road: its eye is a point on the route behind you, its
// gaze a point ahead, each on an exponential follow with its own half-life.
// It never looks along a single segment's heading, so bends sweep instead
// of snapping, and it never goes below the ground.
import * as THREE from 'three';
import { damp } from './damp';
import { yOf } from './geometry';
import { at, type Route } from './route';
import type { SimRider } from './sim';
import type { World } from './world';

export type Follow = 'chase' | 'heli';

const EYE_FLOOR = 1.5; // metres the eye keeps above the drawn ground
const GOAL_FLOOR = 1.8;

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
			const chase = mode === 'chase';
			const back = chase ? 6.5 + Math.min(3, rider.v * 0.15) : 70;
			const b = at(route, rider.d - back);
			want.set(b.x, yOf(route, b.ele) + (chase ? 2.4 : 42), b.z);
			want.y = Math.max(want.y, ground(want.x, want.z) + GOAL_FLOOR);
			const a = at(route, rider.d + (chase ? 18 : 10));
			look.set(a.x, yOf(route, a.ele) + 1.0, a.z).lerp(you, chase ? 0.45 : 0.8);
			if (!started) {
				eye.copy(want);
				gaze.copy(look);
				started = true;
			}
			eye.lerp(want, damp(chase ? 0.22 : 0.6, real));
			gaze.lerp(look, damp(0.12, real));
			// The goal clears the ground; the eased eye can still cut a crest.
			eye.y = Math.max(eye.y, ground(eye.x, eye.z) + EYE_FLOOR);
			camera.position.copy(eye);
			camera.lookAt(gaze);
			const kmh = rider.v * 3.6;
			const fov = chase ? 50 + Math.min(10, Math.max(0, kmh - 20) * 0.25) : 45;
			if (Math.abs(camera.fov - fov) > 0.05) {
				camera.fov += (fov - camera.fov) * damp(0.5, real);
				camera.updateProjectionMatrix();
			}
		},
	};
}
export type Rig = ReturnType<typeof makeRig>;
