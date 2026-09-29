// The pose solver: two-bone IK puts the feet on the pedals and the hands
// on the hoods for any crank angle, seated or out of the saddle.
import * as THREE from 'three';
import { GEO } from './rider-rig';
import type { RiderModel } from './rider-model';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

// Bone -Y points from `from` to `to`; bone +X leans toward `pole`.
function aim(
	bone: THREE.Bone,
	from: THREE.Vector3,
	to: THREE.Vector3,
	pole: THREE.Vector3,
) {
	_y.subVectors(from, to).normalize();
	_z.crossVectors(pole, _y).normalize();
	_x.crossVectors(_y, _z);
	_m.makeBasis(_x, _y, _z);
	bone.position.copy(from);
	bone.quaternion.setFromRotationMatrix(_m);
}

// Two-bone IK: where the knee (or elbow) goes for a hip and a target.
export function twoBone(
	hip: THREE.Vector3,
	target: THREE.Vector3,
	l1: number,
	l2: number,
	pole: THREE.Vector3,
	outKnee: THREE.Vector3,
): THREE.Vector3 {
	const d = Math.min(hip.distanceTo(target), l1 + l2 - 1e-4);
	const dir = _d.subVectors(target, hip).normalize();
	const a = Math.acos(
		THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1),
	);
	const bend = _c.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
	return outKnee
		.copy(hip)
		.addScaledVector(dir, Math.cos(a) * l1)
		.addScaledVector(bend, Math.sin(a) * l1);
}

export type PoseState = {
	crank: number; // rad
	wheel: number; // rad
	stand?: number; // 0 seated … 1 out of the saddle
	rock?: number; // rad, the bike rocking under a standing rider
	rockBody?: number;
	torsoPitch?: number; // rad from horizontal
	headYaw?: number;
	nod?: number;
};

const FWD = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const LEGS = [
	[1, 'thighR', 'shinR', 'footR', 0],
	[-1, 'thighL', 'shinL', 'footL', Math.PI],
] as const;
const ARMS = [
	[1, 'armR', 'foreR'],
	[-1, 'armL', 'foreL'],
] as const;

export function pose(model: RiderModel, st: PoseState): void {
	const b = model.bones;
	const G = GEO;
	const s = st.stand ?? 0;
	b.bike.rotation.set(st.rock ?? 0, 0, 0); // rock around the contact line when standing
	b.frontWheel.position.set(G.front[0], G.front[1], 0);
	b.frontWheel.rotation.set(0, 0, -st.wheel);
	b.rearWheel.position.set(G.rear[0], G.rear[1], 0);
	b.rearWheel.rotation.set(0, 0, -st.wheel);
	b.crank.position.set(G.bb[0], G.bb[1], 0);
	b.crank.rotation.set(0, 0, -st.crank);
	// hips move forward and up when out of the saddle
	const hip = new THREE.Vector3(G.hip[0] + 0.16 * s, G.hip[1] + 0.13 * s, 0);
	const pelvisRoll = (st.rockBody ?? 0) * Math.sin(st.crank);
	b.pelvis.position.copy(hip);
	b.pelvis.rotation.set(pelvisRoll, 0, 0);
	// standing: lower and straighter-armed, or the hands leave the hoods
	const pitch = st.torsoPitch ?? THREE.MathUtils.degToRad(35 - 7 * s);
	b.torso.position.copy(hip).add(new THREE.Vector3(0.02, 0.04, 0));
	b.torso.rotation.set(pelvisRoll * 0.5, 0, -(Math.PI / 2 - pitch));
	const tDir = new THREE.Vector3(0, 1, 0).applyEuler(b.torso.rotation);
	const neck = b.torso.position.clone().addScaledVector(tDir, 0.66);
	b.head.position.copy(neck).add(new THREE.Vector3(0.03, 0.06, 0));
	b.head.rotation.set(
		0,
		st.headYaw ?? 0,
		-(pitch - 0.35) * 0.6 + (st.nod ?? 0),
	);
	for (const [side, th, sh, ft, phase] of LEGS) {
		const a = st.crank + phase;
		const pedal = new THREE.Vector3(
			G.bb[0] + G.crank * Math.cos(a),
			G.bb[1] - G.crank * Math.sin(a),
			0.12 * side,
		);
		const ankle = pedal
			.clone()
			.add(new THREE.Vector3(G.ankleOff[0], G.ankleOff[1], 0));
		const h = hip.clone().add(new THREE.Vector3(0, 0, 0.1 * side));
		const knee = twoBone(
			h,
			ankle,
			G.thigh,
			G.shin,
			_a.set(1, 0, 0.12 * side).normalize(),
			new THREE.Vector3(),
		);
		aim(b[th], h, knee, FWD);
		aim(b[sh], knee, ankle, FWD);
		b[ft].position.copy(ankle);
		b[ft].rotation.set(0, 0, -0.25 * Math.sin(a) - 0.1); // ankling
	}
	// arms to the hoods
	for (const [side, up, fo] of ARMS) {
		const sh = neck
			.clone()
			.addScaledVector(tDir, -0.1)
			.add(new THREE.Vector3(0, 0, 0.19 * side));
		const hand = new THREE.Vector3(G.hoods[0], G.hoods[1], G.hoods[2] * side);
		const elbow = twoBone(
			sh,
			hand,
			G.upperArm,
			G.foreArm,
			_b.set(-0.3, -1, 0.5 * side).normalize(),
			new THREE.Vector3(),
		);
		aim(b[up], sh, elbow, UP);
		aim(b[fo], elbow, hand, UP);
	}
}
