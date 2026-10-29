// The ride picture's own camera (#4263): a photographer standing on the road
// ahead of you, low, at a front three-quarter, with you large on a third of
// a portrait frame and room ahead of you to ride into, and past you the drop
// and the sky rather than the cut slope. It stands on the carriageway or its
// shoulder, where nothing of the dressing grows (#3675), and so does every
// metre of its sightline to you. Beside the ride's rig, never one of its
// cameras: it holds one frame and follows nothing.
import * as THREE from 'three';
import { at, lastMetre, leftOf } from '$lib/road/along';
import type { Route } from '$lib/road/route';
import { yOf } from './geometry';
import { PICTURE } from './picture.svelte';
import { FORMATION } from './terrain/road-profile';
import type { World } from './world';

export const LENS = {
	/** Metres from you, and the field that holds you at about two fifths of the frame's height. */
	off: 5.8,
	fov: 40,
	/** Degrees off your heading the lens may stand at: front three-quarters, the face, the drops and both wheels. */
	turns: [35, 60],
	/** Over the road at the lens: knee height, under the chase camera's 2.4 m. */
	up: 0.9,
	/** How far out each side the ground is read, to tell the uphill side from the drop: the lens tries it first. */
	slopeM: 12,
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

/** A wheel's radius: the tyres meet the road this far under their hubs, and reach this far past them. */
export const TYRE_M = 0.34;
/** The helmet's top over the head's bone. */
export const HELMET_M = 0.25;

/**
 * Your figure's box as it stands now, from its bones: the skinned mesh's own
 * box mixes the skeleton's space with the figure's (#3211), and the bones
 * are where the figure is. It stands from the tyres' contact to the
 * helmet's top, as a reader of the picture measures you (#4278).
 */
export function figureBox(
	figure: THREE.Object3D,
	out = new THREE.Box3(),
): THREE.Box3 {
	figure.updateWorldMatrix(true, true);
	out.makeEmpty();
	const p = new THREE.Vector3();
	figure.traverse((o) => {
		if (!(o as THREE.Bone).isBone) return;
		out.expandByPoint(o.getWorldPosition(p));
		if (o.name.endsWith('Wheel')) out.expandByPoint(p.setY(p.y - TYRE_M));
		if (o.name === 'head') out.expandByPoint(p.setY(p.y + HELMET_M));
	});
	// Along the road and across it, the tyres reach a wheel's radius past their hubs.
	out.min.x -= TYRE_M;
	out.min.z -= TYRE_M;
	out.max.x += TYRE_M;
	out.max.z += TYRE_M;
	return out;
}

/** The frame's top edge, where the sky should be: three points across it, in normalised device coordinates. */
const TOP_EDGE = [-0.6, 0, 0.6].map((x) => new THREE.Vector3(x, 0.95, 0.5));
/** How far along each the ground is read, and in what steps. */
const SKY_M = 300;
const SKY_STEP_M = 5;

/**
 * Stands `camera` for the picture of `figure`, your figure at metre `d` of
 * `route`. Of a few front three-quarter stands on the carriageway and its
 * shoulders, uphill side first, it keeps the one whose frame's top sees
 * the most sky past you rather than the slope; each is aimed so you fall on
 * the third your heading leaves room ahead of.
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
	const out = FORMATION + LENS.slopeM;
	const ground = (side: number) =>
		world.heightAt(here.x + lx * out * side, here.z + lz * out * side);
	const uphill = ground(1) >= ground(-1) ? 1 : -1;
	let best = { sky: -1, side: uphill, turn: LENS.turns[0] };
	for (const side of [uphill, -uphill])
		for (const turn of LENS.turns) {
			stand(camera, route, world, d, side, turn);
			const sky = skyOf(camera, route, world);
			if (sky > best.sky) best = { sky, side, turn };
		}
	stand(camera, route, world, d, best.side, best.turn);
}

/** Metres of open sky along the frame's top edge, summed over its points: where each first meets the ground, or SKY_M. */
function skyOf(camera: THREE.PerspectiveCamera, route: Route, world: World) {
	const dir = new THREE.Vector3();
	const p = new THREE.Vector3();
	let sky = 0;
	for (const edge of TOP_EDGE) {
		dir.copy(edge).unproject(camera).sub(camera.position).normalize();
		let t = SKY_STEP_M;
		for (; t < SKY_M; t += SKY_STEP_M) {
			p.copy(camera.position).addScaledVector(dir, t);
			if (p.y < yOf(route, world.heightAt(p.x, p.z))) break;
		}
		sky += t;
	}
	return sky;
}

/** The lens `turn` degrees off your heading towards `side` (1 left, -1 right), as far off as LENS.off, aimed at you. */
function stand(
	camera: THREE.PerspectiveCamera,
	route: Route,
	world: World,
	d: number,
	side: number,
	turn: number,
) {
	const here = at(route, d);
	const { lx, lz } = leftOf(here.heading);
	const line = (middle.x - here.x) * lx + (middle.z - here.z) * lz;
	const edge = FORMATION - LENS.inside;
	const across = Math.max(
		-edge,
		Math.min(
			edge,
			line + side * LENS.off * Math.sin(THREE.MathUtils.degToRad(turn)),
		),
	);
	// Up the road as far as holds you at the lens's distance.
	const upRoad = Math.sqrt(Math.max(0, LENS.off ** 2 - (across - line) ** 2));
	const ahead = route.loop
		? d + upRoad
		: Math.min(d + upRoad, lastMetre(route));
	const lens = at(route, ahead);
	const l = leftOf(lens.heading);
	const x = lens.x + l.lx * across;
	const z = lens.z + l.lz * across;
	// Over the road or its shoulder, never over the slope beside it.
	const y = yOf(route, world.roadSurfaceAt(x, z) ?? lens.ele) + LENS.up;
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
