// The count-in's reveal (#3087, ADR-0046, ADR-0079): a heli shot from the
// first climb's top, 200 m back and 100 m up from the start, down to the
// start arch, where the last HOLD_S seconds stand still under the digit. Pure:
// it places the eye and its look for `left` seconds of a `total` count-in.
import * as THREE from 'three';

export const HOLD_S = 3;

/** Metres back, up and the climb's reach the shot opens on; the pose it lands on, at the arch. */
export const REVEAL = {
	back: 200,
	up: 100,
	reach: 8000,
	ahead: 3000,
	maxMps: 60,
	maxDegPerS: 20,
	hold: { back: 11, up: 3, banner: 4.5 },
	fov: 50,
};

export type RevealView = { left: number; total: number; still: boolean };

const UP = new THREE.Vector3(0, 1, 0);
const smooth = (u: number) => u * u * (3 - 2 * u);

/**
 * `point(d)` is the route's metre `d` at its drawn height (off the road's
 * start, straight on from it); `climbD` the first climb's top, null when
 * none lies within REVEAL.reach.
 */
export function makeReveal(
	point: (d: number) => THREE.Vector3,
	climbD: number | null,
) {
	const aim = (eye: THREE.Vector3, to: THREE.Vector3) =>
		new THREE.Quaternion().setFromRotationMatrix(
			new THREE.Matrix4().lookAt(eye, to, UP),
		);
	const holdEye = point(-REVEAL.hold.back).add(
		new THREE.Vector3(0, REVEAL.hold.up, 0),
	);
	const holdQ = aim(
		holdEye,
		point(0).add(new THREE.Vector3(0, REVEAL.hold.banner, 0)),
	);
	const openEye = point(-REVEAL.back).add(new THREE.Vector3(0, REVEAL.up, 0));
	const openQ = aim(openEye, point(climbD ?? REVEAL.ahead));
	// Seconds the whole path takes at the speed and turn caps, at the smoothstep's 1.5× peak.
	const need = Math.max(
		(openEye.distanceTo(holdEye) * 1.5) / REVEAL.maxMps,
		(THREE.MathUtils.radToDeg(openQ.angleTo(holdQ)) * 1.5) / REVEAL.maxDegPerS,
		1e-6,
	);
	const forward = new THREE.Vector3();

	/** Writes the shot's eye, orientation and a point ahead on its line into `eye`, `quat` and `gaze`. */
	return function reveal(
		{ left, total, still }: RevealView,
		eye: THREE.Vector3,
		quat: THREE.Quaternion,
		gaze: THREE.Vector3,
	) {
		const flight = total - HOLD_S;
		const u =
			still || flight <= 0
				? 1
				: THREE.MathUtils.clamp((total - left) / flight, 0, 1);
		// A count-in too short for the caps opens nearer the arch, never faster.
		const from = Math.min(1, Math.max(flight, 0) / need) * (1 - smooth(u));
		eye.lerpVectors(holdEye, openEye, from);
		quat.copy(holdQ).slerp(openQ, from);
		gaze.copy(forward.set(0, 0, -40).applyQuaternion(quat)).add(eye);
	};
}
