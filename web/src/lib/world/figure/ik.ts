import * as THREE from 'three';
import { clamp, V } from './math';

/**
 * The pose's inverse kinematics (#3071): where a knee or elbow goes for a
 * root, a target and a pole, the bone frames of a two-bone chain, and the
 * circle meets that place the shoulders.
 */

/** Circle–circle intersection in XY, the upper solution; stays finite when they miss. */
export function circles(
	c1: THREE.Vector3,
	r1: number,
	c2: THREE.Vector3,
	r2: number,
	out: THREE.Vector3,
) {
	const dx = c2.x - c1.x;
	const dy = c2.y - c1.y;
	const d = Math.max(Math.hypot(dx, dy), 1e-6);
	const ux = dx / d;
	const uy = dy / d;
	if (d >= r1 + r2) return out.set(c1.x + ux * r1, c1.y + uy * r1, 0);
	if (d <= Math.abs(r1 - r2)) return out.set(c1.x - uy * r1, c1.y + ux * r1, 0);
	const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
	const h = Math.sqrt(Math.max(r1 * r1 - a * a, 0));
	const px = c1.x + ux * a;
	const py = c1.y + uy * a;
	const y1 = py + ux * h;
	const y2 = py - ux * h;
	return y1 >= y2 ? out.set(px - uy * h, y1, 0) : out.set(px + uy * h, y2, 0);
}

/** A smooth minimum: eases into a limit instead of hitting it. */
export function smin(a: number, b: number, k: number): number {
	const m = Math.min(a, b);
	return m - k * Math.log(Math.exp((m - a) / k) + Math.exp((m - b) / k));
}

const _m = new THREE.Matrix4();
/** Scratch vectors, shared with the pose. */
export const T_ = { a: V(), b: V(), c: V(), d: V(), e: V() };

/** Two-bone IK: where the knee (or elbow) goes, bending toward `pole`. */
export function twoBone(
	root: THREE.Vector3,
	target: THREE.Vector3,
	l1: number,
	l2: number,
	pole: THREE.Vector3,
	outKnee: THREE.Vector3,
	outBend: THREE.Vector3,
) {
	const d = Math.min(root.distanceTo(target), l1 + l2 - 1e-4);
	const dir = T_.a.subVectors(target, root);
	if (dir.lengthSq() < 1e-12) dir.set(0, -1, 0);
	dir.normalize();
	const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
	const bend = outBend.copy(pole).addScaledVector(dir, -pole.dot(dir));
	if (bend.lengthSq() < 1e-10) bend.set(1, 0, 0).addScaledVector(dir, -dir.x);
	bend.normalize();
	return outKnee
		.copy(root)
		.addScaledVector(dir, cosA * l1)
		.addScaledVector(bend, Math.sin(Math.acos(cosA)) * l1);
}

/** Both bones of a chain share the hinge axis (local Z); −Y runs down the bone, +X is the convex side. */
export function chainQuats(
	root: THREE.Vector3,
	mid: THREE.Vector3,
	end: THREE.Vector3,
	bend: THREE.Vector3,
	q1: THREE.Quaternion,
	q2: THREE.Quaternion,
) {
	const dir = T_.b.subVectors(end, root).normalize();
	const h = T_.c.crossVectors(dir, bend).normalize();
	const y = T_.d.subVectors(root, mid).normalize();
	const x = T_.e.crossVectors(y, h);
	q1.setFromRotationMatrix(_m.makeBasis(x, y, h));
	y.subVectors(mid, end).normalize();
	x.crossVectors(y, h);
	q2.setFromRotationMatrix(_m.makeBasis(x, y, h));
}
