import * as THREE from 'three';
import { A0, type Aux } from './contract';
import { clamp, TAU, V, Z_ } from './math';
import type { MeshBuilder, Ring, Weights } from './mesh';

/**
 * The shapes the figure is drawn with (#3070): a cross-section swept along a
 * path, a loft of superellipses along an axis, and ellipsoids — all written
 * into a MeshBuilder in a bone's rest space.
 */

export const M4 = () => new THREE.Matrix4();
export const TR = (x: number, y: number, z: number) =>
	M4().makeTranslation(x, y, z);
export const place = (
	pos: THREE.Vector3,
	q: THREE.Quaternion,
	s = V(1, 1, 1),
) => M4().compose(pos, q, s);
export const qAxis = (ax: THREE.Vector3, a: number) =>
	new THREE.Quaternion().setFromAxisAngle(ax, a);
export const qFromTo = (a: THREE.Vector3, b: THREE.Vector3) =>
	new THREE.Quaternion().setFromUnitVectors(
		a.clone().normalize(),
		b.clone().normalize(),
	);

type Radius = number | [number, number];

export type SweepOptions = {
	bone: number;
	slot: number | ((t: number) => number);
	r: Radius | ((t: number) => Radius);
	sides?: number;
	samples?: number;
	/** Fixes the first frame's normal. */
	ref?: THREE.Vector3;
	shape?: 'ellipse' | 'kamm';
	aux?: Aux;
	weights?: Weights;
	cap?: boolean;
};

/** A cross-section swept along a Catmull-Rom path (bone-local points), in parallel-transport frames. */
export function sweep(
	mb: MeshBuilder,
	pts: THREE.Vector3[],
	o: SweepOptions,
): void {
	const R = mb.rest[o.bone];
	const q = mb.lod ? 0.5 : 1;
	const sides = Math.max(4, Math.round((o.sides ?? 10) * q));
	const path =
		pts.length === 2
			? null
			: new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
	const nS = path
		? Math.max(2, Math.round((o.samples ?? pts.length * 4) * q))
		: 1;
	const at = (t: number) =>
		path ? path.getPoint(t) : pts[0].clone().lerp(pts[1], t);
	const tan = (t: number) =>
		path ? path.getTangent(t) : pts[1].clone().sub(pts[0]).normalize();
	const t0 = tan(0);
	let nrm = (o.ref ?? Z_).clone();
	nrm.addScaledVector(t0, -nrm.dot(t0));
	if (nrm.lengthSq() < 1e-8) nrm = V(0, 1, 0).addScaledVector(t0, -t0.y);
	nrm.normalize();
	const rings: Ring[] = [];
	let prevT = t0;
	const rad = typeof o.r === 'function' ? o.r : () => o.r as Radius;
	for (let i = 0; i <= nS; i++) {
		const t = i / nS;
		const c = at(t);
		const tg = tan(t);
		const ax = V().crossVectors(prevT, tg);
		if (ax.lengthSq() > 1e-12)
			nrm.applyAxisAngle(
				ax.normalize(),
				Math.acos(clamp(prevT.dot(tg), -1, 1)),
			);
		nrm.addScaledVector(tg, -nrm.dot(tg)).normalize();
		prevT = tg;
		const bin = V().crossVectors(tg, nrm);
		const r = rad(t);
		const ra = Array.isArray(r) ? r[0] : r;
		const rb = Array.isArray(r) ? r[1] : r;
		const local: THREE.Vector3[] = [];
		const world: THREE.Vector3[] = [];
		for (let j = 0; j < sides; j++) {
			const ph = (j / sides) * TAU;
			let cx = Math.cos(ph);
			let cy = Math.sin(ph);
			if (o.shape === 'kamm') {
				if (cx < 0) cx *= 0.72;
				cy = Math.sign(cy) * Math.abs(cy) ** 0.8;
			}
			const p = c
				.clone()
				.addScaledVector(nrm, cx * ra)
				.addScaledVector(bin, cy * rb);
			local.push(p.clone());
			world.push(p.applyMatrix4(R));
		}
		const cw = c.clone().applyMatrix4(R);
		const wv = o.weights ? o.weights(cw) : null;
		rings.push({
			pts: world,
			pc: local,
			c: cw,
			bones: wv ? wv[0] : [o.bone],
			w: wv ? wv[1] : [1],
			slot: typeof o.slot === 'function' ? o.slot(t) : o.slot,
			aux: o.aux,
		});
	}
	const capped = o.cap !== false;
	mb.loft(rings, {
		capStart: capped
			? at(0).addScaledVector(t0, -0.0006).applyMatrix4(R)
			: null,
		capEnd: capped
			? at(1).addScaledVector(tan(1), 0.0006).applyMatrix4(R)
			: null,
	});
}

export const tube = (
	mb: MeshBuilder,
	a: THREE.Vector3,
	b: THREE.Vector3,
	r: Radius,
	o: Omit<SweepOptions, 'r'>,
) => sweep(mb, [a, b], { ...o, r });

export type Station = { t: number; slot: number; aux?: Aux; seam?: boolean };
export type Section = {
	c: THREE.Vector3;
	u: THREE.Vector3;
	v: THREE.Vector3;
	ruP: number;
	ruN: number;
	rv?: number;
	rvP?: number;
	rvN?: number;
	/** Superellipse exponent: 2 an ellipse, higher a rounded box. */
	n?: number;
};

/** Superellipse sections lofted along a local axis: torso, pelvis, shoe, saddle, helmet. */
export function axisLoft(
	mb: MeshBuilder,
	stations: Station[],
	shape: (t: number) => Section,
	bone: number,
	o: {
		sides?: number;
		phase?: number;
		aux?: Aux;
		weights?: Weights;
		capStart?: THREE.Vector3;
		capEnd?: THREE.Vector3;
	} = {},
): void {
	const sides = Math.max(8, Math.round((o.sides ?? 20) * (mb.lod ? 0.6 : 1)));
	const R = mb.rest[bone];
	const rings = stations.map((st): Ring => {
		const sh = shape(st.t);
		const local: THREE.Vector3[] = [];
		const world: THREE.Vector3[] = [];
		const e = 2 / (sh.n ?? 2.4);
		for (let j = 0; j < sides; j++) {
			const ph = (j / sides) * TAU + (o.phase ?? 0);
			const c = Math.cos(ph);
			const s = Math.sin(ph);
			const cu = Math.sign(c) * Math.abs(c) ** e;
			const sv = Math.sign(s) * Math.abs(s) ** e;
			const rv = s >= 0 ? (sh.rvP ?? sh.rv ?? 0) : (sh.rvN ?? sh.rv ?? 0);
			const p = sh.c
				.clone()
				.addScaledVector(sh.u, cu * (c >= 0 ? sh.ruP : sh.ruN))
				.addScaledVector(sh.v, sv * rv);
			local.push(p.clone());
			world.push(p.applyMatrix4(R));
		}
		const wv = o.weights ? o.weights(sh.c) : null;
		return {
			pts: world,
			pc: local,
			c: sh.c.clone().applyMatrix4(R),
			bones: wv ? wv[0] : [bone],
			w: wv ? wv[1] : [1],
			slot: st.slot,
			aux: st.aux ?? o.aux,
			seam: st.seam,
		};
	});
	mb.loft(rings, {
		capStart: o.capStart ? o.capStart.clone().applyMatrix4(R) : null,
		capEnd: o.capEnd ? o.capEnd.clone().applyMatrix4(R) : null,
	});
}

/** An ellipsoid of radii (rx, ry, rz) at `c`. */
export function ell(
	mb: MeshBuilder,
	bone: number,
	slot: number,
	c: THREE.Vector3,
	rx: number,
	ry: number,
	rz: number,
	q = new THREE.Quaternion(),
	o: { w?: number; h?: number; aux?: Aux; weights?: Weights } = {},
): void {
	const lod = mb.lod ? 0.6 : 1;
	const g = new THREE.SphereGeometry(
		1,
		Math.max(6, Math.round((o.w ?? 12) * lod)),
		Math.max(4, Math.round((o.h ?? 8) * lod)),
	);
	mb.geo(g, bone, slot, place(c, q, V(rx, ry, rz)), {
		aux: o.aux ?? A0,
		weights: o.weights,
	});
}
