import * as THREE from 'three';
import type { RiderDims } from './bikes/fit';
import { B, S, SP } from './contract';
import type { Kit } from './kit';
import { curve, sstep, V, X_, Y_, Z_ } from './math';
import type { MeshBuilder, Weights } from './mesh';
import {
	axisLoft,
	ell,
	place,
	qAxis,
	sweep,
	TR,
	tube,
	type Station,
} from './shapes';

/**
 * The figure's trunk and ends (#3070): a torso and pelvis sharing a smooth
 * waist, hands that hook round a grip, and shoes clipped to their pedals.
 */

/** The waist: torso and pelvis both rest at the hip centre, weighted by rest height, so the jersey hem wraps the hips. */
const waist =
	(k: number): Weights =>
	(c) => {
		const w = sstep(-0.02 * k, 0.2 * k, c.y);
		return [
			[B.pelvis, B.torso],
			[1 - w, w],
		];
	};

export function buildTorso(mb: MeshBuilder, d: RiderDims): void {
	const { k, build: b } = d;
	const T = d.torso;
	// prettier-ignore
	const hw = curve([[-0.14, 0.168], [-0.06, 0.172], [0.04, 0.166], [0.16, 0.146], [0.3, 0.142], [0.45, 0.15], [0.62, 0.164], [0.8, 0.176], [0.92, 0.168], [1.0, 0.138], [1.05, 0.1], [1.1, 0.064]]);
	// prettier-ignore
	const fr = curve([[-0.14, 0.098], [-0.05, 0.1], [0.05, 0.1], [0.2, 0.094], [0.35, 0.098], [0.55, 0.11], [0.75, 0.102], [0.92, 0.08], [1.02, 0.056], [1.1, 0.038]]);
	// prettier-ignore
	const bk = curve([[-0.14, 0.11], [-0.05, 0.112], [0.05, 0.106], [0.2, 0.09], [0.4, 0.086], [0.62, 0.092], [0.8, 0.098], [0.95, 0.085], [1.04, 0.058], [1.1, 0.038]]);
	const shift = curve([
		[-0.14, 0],
		[0.9, 0],
		[1.1, -0.016],
	]);
	const N = mb.lod ? 10 : 18;
	const st: Station[] = [];
	for (let i = 0; i <= N; i++)
		st.push({
			t: -0.14 + (1.16 * i) / N,
			slot: S.jersey,
			aux: [SP.torso, 0, 0],
		});
	st.push(
		{ t: 1.02, slot: S.jerseyAccent, seam: true },
		{ t: 1.06, slot: S.jerseyAccent },
		{ t: 1.1, slot: S.jerseyAccent },
	);
	// prettier-ignore
	axisLoft(mb, st, (t) => ({ c: V(shift(t) * k, t * T, 0), u: X_, v: Z_, ruP: fr(t) * k * b, ruN: bk(t) * k * b, rv: hw(t) * k * (0.94 + 0.06 * b), n: 2.5 }), B.torso, { sides: 20, capStart: V(0, -0.15 * T, 0), capEnd: V(-0.016 * k, 1.12 * T, 0), weights: waist(k) });
	// Rear pockets and their hem ride the waist weights of the back they sit on.
	for (const z of [-0.075, 0, 0.075])
		// prettier-ignore
		ell(mb, B.torso, S.jersey, V(-bk(0.22) * k * b + 0.001, 0.22 * T, z * k), 0.007, 0.05 * k, 0.033 * k, undefined, { aux: [SP.torso, 0, 0], w: 8, h: 4, weights: waist(k) });
	const hem = -bk(0.32) * k * b - 0.003;
	// prettier-ignore
	tube(mb, V(hem, 0.32 * T, -0.11 * k), V(hem, 0.32 * T, 0.11 * k), 0.0035, { bone: B.torso, slot: S.jerseyAccent, sides: 6, weights: waist(k) });
}

export function buildPelvis(mb: MeshBuilder, d: RiderDims): void {
	const { k, build: b } = d;
	// prettier-ignore
	const hw = curve([[-0.105, 0.06], [-0.08, 0.118], [-0.045, 0.148], [-0.01, 0.154], [0.03, 0.138]]);
	const fr = curve([
		[-0.105, 0.03],
		[-0.07, 0.07],
		[-0.02, 0.084],
		[0.03, 0.08],
	]);
	// prettier-ignore
	const bk = curve([[-0.105, 0.05], [-0.075, 0.094], [-0.04, 0.102], [0.0, 0.098], [0.03, 0.09]]);
	const N = mb.lod ? 6 : 9;
	const st: Station[] = [];
	for (let i = 0; i <= N; i++)
		st.push({ t: -0.105 + (0.135 * i) / N, slot: S.shorts });
	// prettier-ignore
	axisLoft(mb, st, (t) => ({ c: V(-0.01 * k, t * k, 0), u: X_, v: Z_, ruP: fr(t) * k * b, ruN: bk(t) * k * b, rv: hw(t) * k * (0.95 + 0.05 * b), n: 2.3 }), B.pelvis, { sides: 18, capStart: V(-0.01 * k, -0.112 * k, 0), capEnd: V(-0.01 * k, 0.04 * k, 0), weights: waist(k) });
}

/** Hand-local: origin at the wrist, +X toward the knuckles, +Y the back of the hand; the fingers hook down round the grip. */
export function buildHands(mb: MeshBuilder, d: RiderDims, kit: Kit): void {
	const { k, build: b } = d;
	const palm = kit.gloves === 'none' ? S.skin : S.glove;
	const fingers = kit.gloves === 'full' ? S.glove : S.skin;
	for (const [side, bone] of [
		[1, B.handR],
		[-1, B.handL],
	]) {
		const inner = -side;
		ell(
			mb,
			bone,
			palm,
			V(0.004 * k, -0.002 * k, 0),
			0.028 * k,
			0.024 * k,
			0.029 * k,
			undefined,
			{ w: 8, h: 6 },
		);
		// prettier-ignore
		ell(mb, bone, palm, V(0.045 * k, -0.006 * k, 0), 0.05 * k * b, 0.021 * k * b, 0.041 * k * b, undefined, { w: 10, h: 6 });
		// prettier-ignore
		sweep(mb, [V(0.072 * k, -0.001 * k, 0), V(0.094 * k, -0.015 * k, 0), V(0.096 * k, -0.044 * k, 0), V(0.079 * k, -0.058 * k, 0)], { bone, slot: fingers, r: [0.034 * k * b, 0.011 * k * b], ref: Z_, sides: 8, samples: 6 });
		// prettier-ignore
		sweep(mb, [V(0.02 * k, -0.012 * k, inner * 0.03 * k), V(0.05 * k, -0.03 * k, inner * 0.038 * k), V(0.066 * k, -0.046 * k, inner * 0.03 * k)], { bone, slot: fingers, r: 0.011 * k * b, sides: 6, samples: 6 });
	}
}

export function buildFeet(mb: MeshBuilder, d: RiderDims, kit: Kit): void {
	const { k } = d;
	const cl = d.cleat;
	const x0 = -0.068 * k;
	const x1 = 0.2 * k;
	const yb = -0.078 * k;
	const kw = Math.sqrt(k); // feet grow narrower than they grow long
	// prettier-ignore
	const hw = curve([[x0, 0.026 * kw], [-0.04 * k, 0.034 * kw], [0.03 * k, 0.038 * kw], [0.11 * k, 0.047 * kw], [0.17 * k, 0.04 * kw], [x1, 0.02 * kw]]);
	// prettier-ignore
	const top = curve([[x0, -0.02 * k], [-0.05 * k, 0.012 * k], [0.0, 0.004 * k], [0.05 * k, -0.02 * k], [0.12 * k, -0.047 * k], [0.18 * k, -0.06 * k], [x1, -0.068 * k]]);
	const toeUp = curve([
		[x0, 0],
		[0.13 * k, 0],
		[x1, 0.012 * k],
	]);
	for (const [side, bone] of [
		[1, B.footR],
		[-1, B.footL],
	]) {
		const N = mb.lod ? 6 : 10;
		const st: Station[] = [];
		for (let i = 0; i <= N; i++)
			st.push({ t: x0 + ((x1 - x0) * i) / N, slot: S.shoe });
		const shoe = (x: number) => {
			const lo = yb + 0.007 + toeUp(x);
			const hi = top(x);
			return {
				c: V(x, (lo + hi) / 2, 0),
				u: Y_,
				v: Z_,
				ruP: (hi - lo) / 2,
				ruN: (hi - lo) / 2,
				rv: hw(x),
				n: 3,
			};
		};
		axisLoft(mb, st, shoe, bone, {
			sides: 12,
			capStart: V(x0 - 0.004, (yb + top(x0)) / 2, 0),
			capEnd: V(x1 + 0.006 * k, yb + 0.02 * k, 0),
		});
		const sole: Station[] = [];
		for (let i = 0; i <= 6; i++)
			sole.push({ t: x0 + 0.004 + ((x1 - x0 - 0.004) * i) / 6, slot: S.sole });
		// prettier-ignore
		axisLoft(mb, sole, (x) => ({ c: V(x, yb + 0.0045 + toeUp(x), 0), u: Y_, v: Z_, ruP: 0.0045, ruN: 0.0045, rv: hw(x) + 0.0025, n: 4 }), bone, { sides: 10, capStart: V(x0, yb + 0.0045, 0), capEnd: V(x1 + 0.003, yb + 0.006 + toeUp(x1), 0) });
		if (kit.shoes === 'laced')
			for (let i = 0; i < 4; i++) {
				const x = (0.035 + i * 0.03) * k;
				tube(
					mb,
					V(x, top(x) + 0.001, -0.022 * k),
					V(x, top(x) + 0.001, 0.022 * k),
					0.0028 * k,
					{ bone, slot: S.sole, sides: 4 },
				);
			}
		else {
			// prettier-ignore
			mb.geo(new THREE.CylinderGeometry(0.011 * k, 0.011 * k, 0.008 * k, 10), bone, S.metal, place(V(0.075 * k, top(0.075 * k) + 0.003, side * 0.02 * k), qAxis(X_, side * 0.5)));
			// prettier-ignore
			tube(mb, V(0.12 * k, top(0.12 * k) + 0.002, -0.036 * k), V(0.12 * k, top(0.12 * k) + 0.002, 0.036 * k), 0.004 * k, { bone, slot: S.sole, sides: 4 });
		}
		// The pedal's body, clipped under the cleat: it rides with the shoe, centred on the spindle.
		mb.geo(
			new THREE.BoxGeometry(0.084, 0.017, 0.064, 1, 1, 1),
			bone,
			S.hood,
			TR(cl.x, cl.y, -side * 0.006),
		);
	}
}
