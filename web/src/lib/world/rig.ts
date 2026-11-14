// The camera rides the road: its eye is a point on the route behind you, its
// gaze a point ahead, each on an exponential follow with its own half-life.
// Behind and ahead are the way you ride, so a turn at a road's end is a cut
// to behind you again (#4261). It never looks along a single segment's
// heading, so bends sweep instead of snapping, and it never goes below the
// ground.
import * as THREE from 'three';
import { DIORAMA } from './pixel';
import { damp } from '#lib/motion/damp.ts';
import { yOf } from './geometry';
import { type Route } from '#lib/road/route.ts';
import { at, closes, lastMetre, leftOf } from '#lib/road/along.ts';
import type { SimRider } from './sim';
import type { World } from './world';
import { makeReveal, REVEAL, type RevealView } from './reveal';

/** chase, heli and steady follow you; side stands off your right shoulder, a held moment's view of the figure and bike. */
export type Follow = 'chase' | 'heli' | 'side' | 'steady';

/** The side view: metres out to your right, ahead, and up; a three-quarter front, so the face, the drops and both wheels show. */
const SIDE = { out: 3.2, ahead: 1.6, up: 0.3, fov: 40 };

/** Steady (ADR-0079, docs/spec/motion.md): the heli's view from far and high, one FOV, no easing. */
const STEADY = { back: 260, up: 190, fov: 45 };

/** Overhead: high over your shoulder, close enough that you are a rider, with the land ahead in frame. */
export const HELI = { back: 16, up: 8, fov: 45 };
/** Diorama 3D's chase: higher and further back, the riders small on the road and the land round them, like a model railway seen from its edge. */
const DIO = { back: 9.5, up: 4.4, ahead: 34, fov: 44 };

/** The eye's bearing is the chord from this far behind you on the road to this far ahead, eased with this half-life. */
const TAIL_M = 6;
const LEAD_M = 14;
const YAW_HALF_S = 0.28;
const EYE_FLOOR = 1.5; // metres the eye keeps above the drawn ground
/** Past the heli's distances, the widest a camera change moves the goal. */
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
	/** The bearing the following eye looks along, eased; null until it first follows. */
	let yaw: number | null = null;
	let turned = false;
	// Under a roof the eye keeps over the road and under the roof (world.roofAt): in a tunnel the ground is the hill over it.
	const ground = (x: number, z: number) =>
		world.roofAt?.(x, z)?.floor ?? yOf(route, world.heightAt(x, z));
	const under = (v: THREE.Vector3) => {
		const roof = world.roofAt?.(v.x, v.z);
		if (roof) v.y = Math.min(v.y, roof.most);
	};
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
			yaw = null;
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
				yaw = null;
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
				yaw = null;
				return;
			}
			const chase = mode === 'chase';
			const steady = mode === 'steady';
			const dio = chase && DIORAMA.value > 0;
			const back = steady
				? STEADY.back
				: dio
					? DIO.back + Math.min(3, rider.v * 0.13)
					: chase
						? 5.6 + Math.min(2.6, rider.v * 0.13)
						: HELI.back;
			// The eye rides your lane, not the centre line, so your lane leaves you in RIDER_BOX.
			const c = along(route, rider.d, lap);
			const sx = you.x - c.x;
			const sz = you.z - c.z;
			const b = along(route, rider.d - way * back, lap);
			const up = steady ? STEADY.up : dio ? DIO.up : chase ? 2.05 : HELI.up;
			const full = dio ? DIO.ahead : chase ? 18 : 10;
			// Steady and the view from above stand on the road behind you, as they always did.
			if (!chase) {
				want.set(b.x + sx, yOf(route, b.ele) + up, b.z + sz);
				const a = along(route, rider.d + way * full, lap);
				look.set(a.x + sx, yOf(route, a.ele) + 1.0, a.z + sz).lerp(you, 0.8);
			} else {
				// The eye, you and the place it looks at stand on one line in plan, so you are in the middle of the frame through any bend at any speed. The line's bearing is the chord from the road TAIL_M behind you to LEAD_M ahead: it turns a little before you do, and as evenly as the road does. Following the road's own points instead put the eye beside you in a hairpin, where the road 10 m back lies, and you at the frame's edge or off it.
				const p0 = along(route, rider.d - way * TAIL_M, lap);
				const p1 = along(route, rider.d + way * LEAD_M, lap);
				const bearing = Math.atan2(p1.x - p0.x, p1.z - p0.z);
				if (yaw === null) yaw = bearing;
				let turn = bearing - yaw;
				turn -= 2 * Math.PI * Math.round(turn / (2 * Math.PI));
				// A bearing half a turn off is a lap's start or a camera change, not a bend: cut to it.
				yaw =
					Math.abs(turn) > 2.6 ? bearing : yaw + turn * damp(YAW_HALF_S, real);
				const dx = Math.sin(yaw);
				const dz = Math.cos(yaw);
				want.set(you.x - dx * back, yOf(route, b.ele) + up, you.z - dz * back);
				// As far ahead as the road looks on a straight, at the road's height there.
				const reach = full * (dio ? 0.7 : 0.55);
				const a = along(route, rider.d + way * reach, lap);
				look.set(
					you.x + dx * reach,
					(yOf(route, a.ele) + 1.0) * 0.7 + you.y * 0.3,
					you.z + dz * reach,
				);
			}
			want.y = Math.max(want.y, ground(want.x, want.z) + GOAL_FLOOR);
			under(want);
			const kmh = rider.v * 3.6;
			const fov = steady
				? STEADY.fov
				: dio
					? DIO.fov
					: chase
						? 50 + Math.min(4, Math.max(0, kmh - 25) * 0.2)
						: HELI.fov;
			// A goal this far off is a cut — a lap starting where the road began — never a swoop over the map.
			if (!started || eye.distanceTo(want) > CUT_M) {
				eye.copy(want);
				gaze.copy(look);
				camera.fov = fov;
				camera.updateProjectionMatrix();
				started = true;
			}
			// Steady cuts: the eye and gaze are where they belong, never on the way. Following, they keep their line in plan, which the bearing has eased already, and ease only their heights: a crest or a dip comes gently.
			if (steady) {
				eye.copy(want);
				gaze.copy(look);
			} else if (!chase) {
				eye.lerp(want, damp(0.6, real));
				gaze.lerp(look, damp(0.12, real));
			} else {
				eye.set(want.x, eye.y + (want.y - eye.y) * damp(0.22, real), want.z);
				gaze.set(look.x, gaze.y + (look.y - gaze.y) * damp(0.12, real), look.z);
			}
			// The goal clears the ground; the eased eye can still cut a crest.
			eye.y = Math.max(eye.y, ground(eye.x, eye.z) + EYE_FLOOR);
			under(eye);
			camera.position.copy(eye);
			camera.lookAt(gaze);
			if (Math.abs(camera.fov - fov) > 0.05) {
				camera.fov += (fov - camera.fov) * damp(0.5, real);
				camera.updateProjectionMatrix();
			}
		},
	};
}
