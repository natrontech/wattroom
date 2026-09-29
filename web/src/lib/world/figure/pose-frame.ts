import * as THREE from 'three';
import { B } from './contract';
import { V, X_ } from './math';
import type { Rig } from './rig';

/**
 * The pose's frame (#3071): the root takes the road's full pitch and the
 * lean about the tyre's tube, the bike sways about the contact line, and the
 * fork, wheels and crank ride on it. Shared scratch lives here, so a frame
 * allocates next to nothing.
 */

export const _m = new THREE.Matrix4();
export const _m2 = new THREE.Matrix4();
export const _q = new THREE.Quaternion();
export const _q2 = new THREE.Quaternion();
const ONE = V(1, 1, 1);

// prettier-ignore
export const S_ = {
	root: new THREE.Matrix4(), bikeM: new THREE.Matrix4(), forkM: new THREE.Matrix4(), crankM: new THREE.Matrix4(),
	bikeQ: new THREE.Quaternion(), forkQ: new THREE.Quaternion(),
	hip: V(), sh: V(), wR: V(), wL: V(), gR: V(), gL: V(), qR: new THREE.Quaternion(), qL: new THREE.Quaternion(),
	knee: V(), bend: V(), ankle: V(), sp: V(), hj: V(), pole: V(), elbow: V(), el: V(), mid: V(), xw: V(), zw: V(), neck: V(),
	qa: new THREE.Quaternion(), qb: new THREE.Quaternion(), qf: new THREE.Quaternion(), tx: V(), ty: V(), tz: V(),
	tq: new THREE.Quaternion(), pq: new THREE.Quaternion(), s1: V(), s2: V(),
};

export function setBone(
	bones: THREE.Bone[],
	i: number,
	pos: THREE.Vector3,
	q: THREE.Quaternion,
) {
	bones[i].matrix.multiplyMatrices(S_.root, _m2.compose(pos, q, ONE));
	bones[i].matrixWorldNeedsUpdate = true;
}
export function setBoneM(bones: THREE.Bone[], i: number, M: THREE.Matrix4) {
	bones[i].matrix.multiplyMatrices(S_.root, M);
	bones[i].matrixWorldNeedsUpdate = true;
}

/** The bike's frame of reference, and every bone that is part of the bike: root, bike, fork, wheels, crank. */
export function poseFrame(
	bones: THREE.Bone[],
	bk: Rig['bk'],
	o: {
		pitch: number;
		lean: number;
		sway: number;
		steer: number;
		crank: number;
		wheel: number;
	},
): void {
	const { pitch, lean, sway, steer, crank, wheel } = o;
	const rt = bk.rt;
	// Root: the road's full pitch, and the lean about the tyre's tube, so the contact stays on the road.
	S_.root
		.makeRotationZ(pitch)
		.multiply(_m.makeTranslation(0, rt, 0))
		.multiply(_m2.makeRotationX(lean))
		.multiply(_m.makeTranslation(0, -rt, 0));
	S_.bikeM
		.makeTranslation(0, rt, 0)
		.multiply(_m.makeRotationX(sway))
		.multiply(_m2.makeTranslation(0, -rt, 0));
	S_.bikeQ.setFromAxisAngle(X_, sway);
	// Fork: steer about the steering axis, through the head tube's top.
	S_.forkM
		.copy(S_.bikeM)
		.multiply(_m.makeTranslation(bk.htTop.x, bk.htTop.y, 0))
		.multiply(_m2.makeRotationAxis(bk.up, -steer))
		.multiply(_m.makeTranslation(-bk.htTop.x, -bk.htTop.y, 0));
	S_.forkQ.copy(S_.bikeQ).multiply(_q.setFromAxisAngle(bk.up, -steer));
	setBoneM(bones, B.root, _m.identity());
	setBoneM(bones, B.bike, S_.bikeM);
	setBoneM(bones, B.fork, S_.forkM);
	setBoneM(
		bones,
		B.frontWheel,
		_m2
			.copy(S_.forkM)
			.multiply(_m.makeTranslation(bk.front.x, bk.front.y, 0))
			.multiply(_m.makeRotationZ(-wheel)),
	);
	setBoneM(
		bones,
		B.rearWheel,
		_m2
			.copy(S_.bikeM)
			.multiply(_m.makeTranslation(bk.rear.x, bk.rear.y, 0))
			.multiply(_m.makeRotationZ(-wheel)),
	);
	S_.crankM
		.copy(S_.bikeM)
		.multiply(_m.makeTranslation(bk.bb.x, bk.bb.y, 0))
		.multiply(_m2.makeRotationZ(-crank));
	setBoneM(bones, B.crank, S_.crankM);
}
