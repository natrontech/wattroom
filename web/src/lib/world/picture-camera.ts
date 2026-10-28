// The ride picture's own camera (#4263): a photographer standing on the road
// ahead of you, low, at a front three-quarter, with you large on a third of
// a portrait frame and room ahead of you to ride into. It stands on the
// carriageway or its shoulder, where nothing of the dressing grows (#3675),
// and so does every metre of its sightline to you. Beside the ride's rig,
// never one of its cameras: it holds one frame and follows nothing.
import * as THREE from 'three';
import { at, lastMetre, leftOf } from '$lib/road/along';
import type { Route } from '$lib/road/route';
import { yOf } from './geometry';
import { PICTURE } from './picture.svelte';
import { FORMATION } from './terrain/road-profile';
import type { World } from './world';

export const LENS = {
	/** Metres up the road from you, and across it from your line: a three-quarter front, about 7 m off. */
	ahead: 5.6,
	across: 4.2,
	/** Over the road at the lens: knee height, under the chase camera's 2.4 m. */
	up: 0.9,
	fov: 42,
	/** Where your figure's middle falls, as shares of the frame from the top left. */
	thirds: [1 / 3, 2 / 3],
	down: 0.62,
	/** How far in from the formation's edge the lens keeps: clear of the verge the dressing starts at. */
	inside: 0.8,
};

const middle = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const gaze = new THREE.Vector3();
const box = new THREE.Box3();

/** A wheel's radius, and what the head stands over its bone: the figure's skin reaches this far past its bones. */
const SKIN_M = 0.35;

/**
 * Your figure's box as it stands now, from its bones: the skinned mesh's own
 * box mixes the skeleton's space with the figure's (#3211), and the bones
 * are where the figure is.
 */
export function figureBox(
	figure: THREE.Object3D,
	out = new THREE.Box3(),
): THREE.Box3 {
	figure.updateWorldMatrix(true, true);
	out.makeEmpty();
	const p = new THREE.Vector3();
	figure.traverse((o) => {
		if ((o as THREE.Bone).isBone) out.expandByPoint(o.getWorldPosition(p));
	});
	return out.expandByScalar(SKIN_M);
}

/**
 * Stands `camera` for the picture of `figure`, your figure at metre `d` of
 * `route`: the lens up the road on the side away from your line, aimed so
 * you fall on the third your heading leaves room ahead of.
 */
export function framePicture(
	camera: THREE.PerspectiveCamera,
	route: Route,
	world: World,
	figure: THREE.Object3D,
	d: number,
) {
	figureBox(figure, box).getCenter(middle);
	const here = at(route, d);
	const { lx, lz } = leftOf(here.heading);
	const line = (middle.x - here.x) * lx + (middle.z - here.z) * lz;
	const edge = FORMATION - LENS.inside;
	const across = Math.max(
		-edge,
		Math.min(edge, line + (line > 0 ? -1 : 1) * LENS.across),
	);
	const ahead = route.loop
		? d + LENS.ahead
		: Math.min(d + LENS.ahead, lastMetre(route));
	const lens = at(route, ahead);
	const l = leftOf(lens.heading);
	const x = lens.x + l.lx * across;
	const z = lens.z + l.lz * across;
	const road = world.roadSurfaceAt(x, z) ?? lens.ele;
	const y =
		Math.max(yOf(route, road), yOf(route, world.heightAt(x, z))) + LENS.up;
	camera.position.set(x, y, z);
	camera.fov = LENS.fov;
	camera.aspect = PICTURE.width / PICTURE.height;
	camera.updateProjectionMatrix();

	// Room ahead: you ride towards one side of the frame, so you stand on the other's third.
	camera.lookAt(middle);
	camera.updateMatrixWorld();
	forward.set(Math.sin(here.heading), 0, Math.cos(here.heading));
	right.setFromMatrixColumn(camera.matrixWorld, 0);
	const third = forward.dot(right) < 0 ? LENS.thirds[1] : LENS.thirds[0];
	const want = { x: third * 2 - 1, y: 1 - LENS.down * 2 };
	// Turn the lens until your middle lands there: a few steps, each the error at your distance.
	const far = camera.position.distanceTo(middle);
	const tanV = Math.tan(THREE.MathUtils.degToRad(LENS.fov / 2));
	const tanH = tanV * camera.aspect;
	gaze.copy(middle);
	for (let k = 0; k < 4; k++) {
		camera.lookAt(gaze);
		camera.updateMatrixWorld();
		const seen = middle.clone().project(camera);
		right.setFromMatrixColumn(camera.matrixWorld, 0);
		up.setFromMatrixColumn(camera.matrixWorld, 1);
		gaze
			.addScaledVector(right, (seen.x - want.x) * far * tanH)
			.addScaledVector(up, (seen.y - want.y) * far * tanV);
	}
	camera.lookAt(gaze);
	camera.updateMatrixWorld();
}
