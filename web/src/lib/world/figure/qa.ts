import * as THREE from 'three';
import type { GripName } from './bikes/fit';
import { B } from './contract';
import type { Figure } from './figure';
import { armProfile, legProfile, type Section } from './limbs';

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

/** G8: metres between each part and the place it is fixed to — hubs in their dropouts, the crank in its shell, the fork in its head tube, cleats on pedals and, when both hands are on `grip`, the hands on the bar. */
export function partGaps(m: Figure, grip?: GripName): number[] {
	const { bk, fit, dims: d } = m.userData.rig;
	const bike = (p: THREE.Vector3) => at(m, B.bike, p.x, p.y, p.z);
	const fork = (p: THREE.Vector3) => at(m, B.fork, p.x, p.y, p.z);
	const gaps = [
		at(m, B.rearWheel).distanceTo(bike(bk.rear)),
		at(m, B.frontWheel).distanceTo(fork(bk.front)),
		at(m, B.crank).distanceTo(bike(bk.bb)),
		fork(bk.htTop).distanceTo(bike(bk.htTop)),
		fork(bk.htBot).distanceTo(bike(bk.htBot)),
		...LEGS.map(([side, , , foot]) =>
			at(m, foot, d.cleat.x, d.cleat.y).distanceTo(
				at(m, B.crank, side * fit.crank, 0, side * fit.pedalZ),
			),
		),
	];
	const pair = grip && fit.grips[grip];
	if (pair)
		for (const [side, hand] of [
			['R', B.handR],
			['L', B.handL],
		] as const)
			gaps.push(at(m, hand, d.grip.x, d.grip.y).distanceTo(fork(pair[side].p)));
	return gaps;
}

/** A segment with a radius; a frame tube's is `r` in the bike's plane and `w` across it (aero tubes are tall and narrow). */
type Capsule = { a: THREE.Vector3; b: THREE.Vector3; r: number; w?: number };

/** The closest points of two segments (Ericson, Real-Time Collision Detection 5.1.9). */
function segDist(
	p1: THREE.Vector3,
	q1: THREE.Vector3,
	p2: THREE.Vector3,
	q2: THREE.Vector3,
): [THREE.Vector3, THREE.Vector3] {
	const d1 = q1.clone().sub(p1);
	const d2 = q2.clone().sub(p2);
	const r = p1.clone().sub(p2);
	const a = d1.dot(d1);
	const e = d2.dot(d2);
	const f = d2.dot(r);
	const c = d1.dot(r);
	const b = d1.dot(d2);
	const den = a * e - b * b;
	let s = den > 1e-12 ? Math.min(Math.max((b * f - c * e) / den, 0), 1) : 0;
	let t = (b * s + f) / e;
	if (t < 0) {
		t = 0;
		s = Math.min(Math.max(-c / a, 0), 1);
	} else if (t > 1) {
		t = 1;
		s = Math.min(Math.max((b - c) / a, 0), 1);
	}
	return [p1.clone().addScaledVector(d1, s), p2.clone().addScaledVector(d2, t)];
}

/** A limb as capsules along its bones, as thick as the mesh's own cross-section there: `side` its half-width across the body, else its widest. */
function limbCapsules(
	m: Figure,
	bones: readonly [number, number],
	L1: number,
	L2: number,
	section: Section,
	side: boolean,
	n = 6,
): Capsule[] {
	const out: Capsule[] = [];
	const pt = (s: number) =>
		s <= L1 ? at(m, bones[0], 0, -s) : at(m, bones[1], 0, -(s - L1));
	for (let i = 0; i < n; i++) {
		const s0 = ((L1 + L2) * i) / n;
		const s1 = ((L1 + L2) * (i + 1)) / n;
		const r = Math.max(
			...[s0, (s0 + s1) / 2, s1].map((s) => {
				const p = section(s);
				return side ? p.z : Math.max(p.xP, p.xN, p.z);
			}),
		);
		out.push({ a: pt(s0), b: pt(s1), r });
	}
	return out;
}

/** G10: the least clearance, metres, between the legs and the frame's tubes, and between the forearms and the thighs; below zero, they pass through each other. */
export function clearance(m: Figure): { frame: number; arms: number } {
	const { bk, dims: d } = m.userData.rig;
	const t = m.userData.kit.tubes;
	const aspect =
		t.shape === 'kamm' || t.shape === 'aero' ? (t.aspect ?? 1.8) : 1;
	const bike = (p: THREE.Vector3) => at(m, B.bike, p.x, p.y, p.z);
	const tubes: Capsule[] = [
		{ a: bike(bk.ttFront), b: bike(bk.cluster), r: t.tt * aspect, w: t.tt },
		{ a: bike(bk.dtFront), b: bike(bk.bb), r: t.dt * aspect, w: t.dt },
		...[1, -1].map((s) => ({
			a: bike(bk.bb.clone().add(new THREE.Vector3(-0.012, 0, 0.034 * s))),
			b: bike(bk.rear.clone().add(new THREE.Vector3(0.012, 0, 0.066 * s))),
			r: t.cs * aspect,
			w: t.cs,
		})),
	];
	const leg = legProfile(d);
	const arm = armProfile(d);
	// The tubes lie in the bike's centre plane, the legs beside it: across the body is what can touch.
	const legs = LEGS.flatMap(([, thigh, shin]) =>
		limbCapsules(m, [thigh, shin], d.thigh, d.shin, leg, true),
	);
	const thighs = LEGS.flatMap(([, thigh, shin]) =>
		limbCapsules(m, [thigh, shin], d.thigh, d.shin, leg, false).slice(0, 3),
	);
	const fores = ARMS.flatMap(([up, fore]) =>
		limbCapsules(m, [up, fore], d.upperArm, d.foreArm, arm, false).slice(3),
	);
	// Across the bike is its bone's Z; a tube's radius toward a limb is its ellipse's, that way.
	const across = new THREE.Vector3(0, 0, 1).transformDirection(
		m.skeleton.bones[B.bike].matrix,
	);
	const least = (xs: Capsule[], ys: Capsule[]) => {
		let l = Infinity;
		for (const x of xs)
			for (const y of ys) {
				const [p, q] = segDist(x.a, x.b, y.a, y.b);
				const gap = p.distanceTo(q);
				const sin = gap > 1e-9 ? Math.abs(p.sub(q).dot(across)) / gap : 0;
				const ry = y.w
					? (y.r * y.w) / Math.hypot(y.w * Math.sqrt(1 - sin * sin), y.r * sin)
					: y.r;
				l = Math.min(l, gap - x.r - ry);
			}
		return l;
	};
	return { frame: least(legs, tubes), arms: least(fores, thighs) };
}

const BODY = [
	B.pelvis,
	B.torso,
	B.head,
	B.thighL,
	B.shinL,
	B.footL,
	B.thighR,
	B.shinR,
	B.footR,
	B.armL,
	B.foreL,
	B.armR,
	B.foreR,
	B.handL,
	B.handR,
];

/** G12: every body joint, and a point 10 cm along two axes of each body bone — rotations pop too. */
export function joints(m: Figure): number[] {
	const out: number[] = [];
	for (const i of BODY)
		for (const [x, y] of [
			[0, 0],
			[0.1, 0],
			[0, 0.1],
		]) {
			const p = at(m, i, x, y, 0, _a);
			out.push(p.x, p.y, p.z);
		}
	return out;
}

/** G12: the largest second difference of any point across three consecutive frames, metres. Smooth motion stays near its acceleration × dt² — the pedals' circles and a sprint's sway peak near 15 mm at 60 fps — while a jump shows its whole size. */
export function pop(a: number[], b: number[], c: number[]): number {
	let worst = 0;
	for (let i = 0; i < a.length; i += 3)
		worst = Math.max(
			worst,
			Math.hypot(
				a[i] - 2 * b[i] + c[i],
				a[i + 1] - 2 * b[i + 1] + c[i + 1],
				a[i + 2] - 2 * b[i + 2] + c[i + 2],
			),
		);
	return worst;
}
