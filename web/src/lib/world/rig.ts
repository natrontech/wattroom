// The camera rides the road: its eye is a point on the route behind you, its
// gaze a point ahead, each on an exponential follow with its own half-life.
// Behind and ahead are the way you ride, so a turn at a road's end is a cut
// to behind you again (#4261). It never looks along a single segment's
// heading, so bends sweep instead of snapping, and it never goes below the
// ground.
import * as THREE from 'three';
import { damp } from '$lib/motion/damp';
import { yOf } from './geometry';
import { type Route } from '$lib/road/route';
import { at, closes, lastMetre, leftOf } from '$lib/road/along';
import type { SimRider } from './sim';
import type { World } from './world';
import { makeReveal, REVEAL, type RevealView } from './reveal';

/** chase, heli and steady follow you; side stands off your right shoulder, a held moment's view of the figure and bike. */
export type Follow = 'chase' | 'heli' | 'side' | 'steady';

/** The side view: metres out to your right, ahead, and up; a three-quarter front, so the face, the drops and both wheels show. */
const SIDE = { out: 3.2, ahead: 1.6, up: 0.3, fov: 40 };

/** Steady (ADR-0079, docs/spec/motion.md): the heli's view from far and high, one FOV, no easing. */
const STEADY = { back: 260, up: 190, fov: 45 };

const EYE_FLOOR = 1.5; // metres the eye keeps above the drawn ground
/** Past the heli's 70 m and 42 m, the widest a camera change moves the goal. */
const CUT_M = 500;
const GOAL_FLOOR = 1.8;

/**
 * The route `d` metres along, in the lap that starts at `from`; off either
 * end of a road that does not close, straight on from that end — at a
 * ride's first metre, or a lap's, the eye stands behind you, not on you
 * (#3663, #3623).
 */
function along(route: Route, d: number, from = 0) {
	if (closes(route)) return at(route, d);
	const u = d - from;
	// Its last metre short of the end: on a lapped road the end is the next lap's start.
	const end = u < 0 ? 0 : lastMetre(route);
	if (u >= 0 && u <= end) return at(route, u);
	const p = at(route, end);
	return {
		...p,
		x: p.x + Math.sin(p.heading) * (u - end),
		z: p.z + Math.cos(p.heading) * (u - end),
	};
}

export function makeRig(route: Route, world: World) {
	const eye = new THREE.Vector3();
	const gaze = new THREE.Vector3();
	const want = new THREE.Vector3();
	const look = new THREE.Vector3();
	let started = false;
	let turned = false;
	const ground = (x: number, z: number) => yOf(route, world.heightAt(x, z));
	const climb = world.markers.find(
		(m) => m.kind === 'summit' && m.d > 0 && m.d <= REVEAL.reach,
	);
	const reveal = makeReveal((d) => {
		const p = along(route, d);
		return new THREE.Vector3(p.x, yOf(route, p.ele), p.z);
	}, climb?.d ?? null);
	const spin = new THREE.Quaternion();

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
			countIn: RevealView | null = null,
		) {
			// A turn is a shot change: a cut, never a swing through you (ADR-0079).
			if (!!rider.reverse !== turned) {
				turned = !!rider.reverse;
				started = false;
			}
			const way = turned ? -1 : 1;
			// Where the rider's lap began, on a lapped road (#3623).
			const lap = route.loop
				? Math.floor(rider.d / route.length) * route.length
				: 0;
			if (countIn && mode !== 'side') {
				reveal(countIn, eye, spin, gaze);
				eye.y = Math.max(eye.y, ground(eye.x, eye.z) + EYE_FLOOR);
				camera.position.copy(eye);
				camera.quaternion.copy(spin);
				if (camera.fov !== REVEAL.fov) {
					camera.fov = REVEAL.fov;
					camera.updateProjectionMatrix();
				}
				// The ride's first frames ease on from where the shot stood.
				started = true;
				return;
			}
			if (mode === 'side') {
				const p = along(route, rider.d, lap);
				const h = turned ? p.heading + Math.PI : p.heading;
				const { lx, lz } = leftOf(h);
				camera.position.set(
					you.x - lx * SIDE.out + Math.sin(h) * SIDE.ahead,
					you.y + SIDE.up,
					you.z - lz * SIDE.out + Math.cos(h) * SIDE.ahead,
				);
				camera.lookAt(you);
				camera.fov = SIDE.fov;
				camera.updateProjectionMatrix();
				started = false;
				return;
			}
			const chase = mode === 'chase';
			const steady = mode === 'steady';
			const back = steady
				? STEADY.back
				: chase
					? 7.2 + Math.min(3, rider.v * 0.15)
					: 70;
			// The eye rides your lane, not the centre line, so your lane leaves you in RIDER_BOX.
			const c = along(route, rider.d, lap);
			const sx = you.x - c.x;
			const sz = you.z - c.z;
			const b = along(route, rider.d - way * back, lap);
			want.set(
				b.x + sx,
				yOf(route, b.ele) + (steady ? STEADY.up : chase ? 2.4 : 42),
				b.z + sz,
			);
			want.y = Math.max(want.y, ground(want.x, want.z) + GOAL_FLOOR);
			const a = along(route, rider.d + way * (chase ? 18 : 10), lap);
			look
				.set(a.x + sx, yOf(route, a.ele) + 1.0, a.z + sz)
				.lerp(you, chase ? 0.45 : 0.8);
			const kmh = rider.v * 3.6;
			const fov = steady
				? STEADY.fov
				: chase
					? 50 + Math.min(4, Math.max(0, kmh - 25) * 0.2)
					: 45;
			// A goal this far off is a cut — a lap starting where the road began — never a swoop over the map.
			if (!started || eye.distanceTo(want) > CUT_M) {
				eye.copy(want);
				gaze.copy(look);
				camera.fov = fov;
				camera.updateProjectionMatrix();
				started = true;
			}
			// Steady cuts: the eye and gaze are where they belong, never on the way.
			if (steady) {
				eye.copy(want);
				gaze.copy(look);
			} else {
				eye.lerp(want, damp(chase ? 0.22 : 0.6, real));
				gaze.lerp(look, damp(0.12, real));
			}
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
