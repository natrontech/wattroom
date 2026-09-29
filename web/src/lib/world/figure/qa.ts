import * as THREE from 'three';
import { B } from './contract';
import type { Figure } from './figure';

/**
 * Pure measurements of a posed figure (#3071; #3072 grows the rest). Every
 * pose bug so far was silent in a screenshot and obvious in a number. The
 * bones are the mesh's direct children, so their matrices are in its space.
 */

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const at = (
	m: Figure,
	i: number,
	x = 0,
	y = 0,
	z = 0,
	out = new THREE.Vector3(),
) => out.set(x, y, z).applyMatrix4(m.skeleton.bones[i].matrix);

const LEGS = [
	[1, B.thighR, B.shinR, B.footR],
	[-1, B.thighL, B.shinL, B.footL],
] as const;
const ARMS = [
	[B.armR, B.foreR, B.handR],
	[B.armL, B.foreL, B.handL],
] as const;

/** G1: metres between each spindle and the cleat of a foot hanging from the end of its shin. */
export function cleatGaps(m: Figure): number[] {
	const { dims: d, fit } = m.userData.rig;
	return LEGS.map(([side, , shin, foot]) => {
		const spindle = at(m, B.crank, side * fit.crank, 0, side * fit.pedalZ);
		const ankle = at(m, shin, 0, -d.shin, 0, _a);
		_q.setFromRotationMatrix(m.skeleton.bones[foot].matrix);
		const cleat = _b
			.set(d.cleat.x, d.cleat.y, 0)
			.applyQuaternion(_q)
			.add(ankle);
		return cleat.distanceTo(spindle);
	});
}

/** G4: the right knee's flexion, degrees (0 is a straight leg). */
export function kneeFlexion(m: Figure): number {
	const d = m.userData.rig.dims;
	const hip = at(m, B.thighR);
	const knee = at(m, B.shinR);
	const ankle = at(m, B.shinR, 0, -d.shin, 0);
	return 180 - (hip.sub(knee).angleTo(ankle.sub(knee)) * 180) / Math.PI;
}

/** G7: metres between each forearm's end and the wrist its hand hangs on. */
export function wristGaps(m: Figure): number[] {
	const d = m.userData.rig.dims;
	return ARMS.map(([, fore, hand]) =>
		at(m, fore, 0, -d.foreArm, 0, _a).distanceTo(at(m, hand, 0, 0, 0, _b)),
	);
}

/** G9: metres between each tyre's lowest point and the road (the pitched plane through the origin). */
export function tyreGaps(m: Figure): number[] {
	const { bk } = m.userData.rig;
	const root = m.skeleton.bones[B.root].matrix;
	// The lean turns about the root's X, so its X is the road's own direction.
	const x = new THREE.Vector3(1, 0, 0).transformDirection(root);
	const pitch = Math.atan2(x.y, x.x);
	const road = new THREE.Vector3(-Math.sin(pitch), Math.cos(pitch), 0);
	return [B.rearWheel, B.frontWheel].map((w) => {
		const c = at(m, w);
		const n = new THREE.Vector3(0, 0, 1).transformDirection(
			m.skeleton.bones[w].matrix,
		);
		const down = road.clone().addScaledVector(n, -road.dot(n)).normalize();
		const low = c
			.addScaledVector(down, -(bk.R - bk.rt))
			.addScaledVector(road, -bk.rt);
		return Math.abs(low.dot(road));
	});
}

/** G14: every bone matrix is finite. */
export function finite(m: Figure): boolean {
	return m.skeleton.bones.every((b) =>
		b.matrix.elements.every(Number.isFinite),
	);
}
