import * as THREE from 'three';
import type { RiderDims } from './bikes/fit';
import { B, S } from './contract';
import type { Kit } from './kit';
import { curve, lerp, TAU, V, Y_, Z_ } from './math';
import type { MeshBuilder } from './mesh';
import { axisLoft, ell, qAxis, sweep, TR, tube, type Station } from './shapes';

/**
 * The figure's head (#3070): head-local, origin at C7 (the neck's base), +X
 * the face, +Y up. The skull sits forward of C7 — a cyclist's neck is
 * extended — under a helmet shell, with glasses over the eyes.
 */

/** Stylised athletic: a touch more head (and helmet) than life, about seven helmeted heads tall. */
export const HEAD_SCALE = 1.08;

// prettier-ignore
const SHELLS = {
	road: {
		X: [0.104, 0.085, 0.045, 0.0, -0.045, -0.085, -0.108, -0.122],
		W: [0.04, 0.078, 0.1, 0.105, 0.101, 0.088, 0.068, 0.034],
		TOP: [0.04, 0.078, 0.102, 0.11, 0.104, 0.082, 0.052, 0.012],
		RIM: [0.03, 0.022, 0.016, 0.005, -0.012, -0.03, -0.044, -0.042],
	},
	aero: {
		X: [0.104, 0.085, 0.045, 0.0, -0.05, -0.1, -0.15, -0.2, -0.245],
		W: [0.04, 0.078, 0.1, 0.104, 0.1, 0.086, 0.064, 0.038, 0.012],
		TOP: [0.04, 0.078, 0.102, 0.108, 0.1, 0.083, 0.058, 0.032, 0.008],
		RIM: [0.03, 0.022, 0.016, 0.006, -0.012, -0.028, -0.034, -0.03, -0.018],
	},
};

function buildShell(
	mb: MeshBuilder,
	K: THREE.Vector3,
	k: number,
	aero: boolean,
): void {
	const { X, W, TOP, RIM } = SHELLS[aero ? 'aero' : 'road'];
	const along = (ys: number[]) =>
		curve(X.map((x, i): [number, number] => [x, ys[i]]).reverse());
	const w = along(W);
	const top = along(TOP);
	const rim = along(RIM);
	const last = X[X.length - 1];
	const n = mb.lod ? 6 : 10;
	const st: Station[] = [];
	for (let i = 0; i <= n; i++)
		st.push({ t: lerp(last, X[0], i / n), slot: S.helmet });
	// A loft along X; each station an ellipse between the rim line and the crown.
	// prettier-ignore
	axisLoft(mb, st, (x) => ({ c: V(K.x + x * k, K.y + ((top(x) + rim(x)) / 2) * k, 0), u: Y_, v: Z_, ruP: ((top(x) - rim(x)) / 2) * k, ruN: ((top(x) - rim(x)) / 2) * k, rv: w(x) * k, n: 2.3 }), B.head, { sides: 16, capStart: V(K.x + (last - 0.004) * k, K.y + rim(last) * k + 0.01 * k, 0), capEnd: V(K.x + (X[0] + 0.004) * k, K.y + ((top(X[0]) + rim(X[0])) / 2) * k, 0) });
	// Vents (dark slots) along the crown of a road helmet.
	if (!aero)
		for (const z of [-0.042, 0, 0.042])
			// prettier-ignore
			sweep(mb, [0.075, 0.04, 0.0, -0.04, -0.075].map((x) => V(K.x + x * k, K.y + (top(x) * Math.sqrt(Math.max(1 - (z / w(x)) ** 2, 0.2)) + 0.001) * k, z * k * 1.02)), { bone: B.head, slot: S.hood, r: [0.004 * k, 0.009 * k], ref: Y_, sides: 4, samples: 5 });
	// An accent band round the lower shell.
	const ring: THREE.Vector3[] = [];
	for (let i = 0; i <= 24; i++) {
		const a = (i / 24) * TAU;
		const x = last + (X[0] - last) * (0.5 + 0.5 * Math.cos(a));
		ring.push(
			V(
				K.x + x * k,
				K.y + (rim(x) + (top(x) - rim(x)) * 0.14) * k,
				w(x) * 1.004 * Math.sin(a) * k,
			),
		);
	}
	sweep(mb, ring, {
		bone: B.head,
		slot: S.helmetAccent,
		r: [0.007 * k, 0.004 * k],
		ref: Y_,
		sides: 4,
		samples: 18,
		cap: false,
	});
	// Straps.
	for (const s of [1, -1])
		// prettier-ignore
		sweep(mb, [K.clone().add(V(0.0, -0.01 * k, s * 0.1 * k)), K.clone().add(V(0.02 * k, -0.06 * k, s * 0.07 * k)), K.clone().add(V(0.055 * k, -0.098 * k, s * 0.028 * k))], { bone: B.head, slot: S.hood, r: 0.003 * k, sides: 4, samples: 6 });
}

function buildHairnet(mb: MeshBuilder, K: THREE.Vector3, k: number): void {
	for (const z of [-0.052, -0.018, 0.018, 0.052])
		// prettier-ignore
		sweep(mb, [V(0.082, 0.028, z * 1.05), V(0.05, 0.088, z), V(-0.02, 0.1, z), V(-0.078, 0.066, z), V(-0.098, 0.0, z * 1.05)].map((p) => p.multiplyScalar(k).add(K)), { bone: B.head, slot: S.helmet, r: 0.017 * k, sides: 6, samples: 8 });
	const ring: THREE.Vector3[] = [];
	for (let i = 0; i <= 20; i++) {
		const a = (i / 20) * TAU;
		ring.push(
			K.clone().add(
				V(
					Math.cos(a) * 0.093 * k,
					0.018 * k - 0.024 * k * Math.cos(a),
					Math.sin(a) * 0.087 * k,
				),
			),
		);
	}
	sweep(mb, ring, {
		bone: B.head,
		slot: S.helmetAccent,
		r: [0.017 * k, 0.01 * k],
		ref: Y_,
		sides: 5,
		samples: 24,
		cap: false,
	});
}

function buildGlasses(
	mb: MeshBuilder,
	K: THREE.Vector3,
	k: number,
	style: Kit['glasses'],
): void {
	const eyeY = K.y - 0.004 * k;
	if (style === 'wrap' || style === 'shield') {
		const h = style === 'shield' ? 0.021 : 0.014;
		const pts: THREE.Vector3[] = [];
		for (let i = 0; i <= 12; i++) {
			const a = lerp(-1.2, 1.2, i / 12);
			pts.push(
				V(
					K.x + (Math.cos(a) * 0.094 + 0.006) * k,
					eyeY + (style === 'shield' ? 0.004 : 0) * k,
					Math.sin(a) * 0.088 * k,
				),
			);
		}
		sweep(mb, pts, {
			bone: B.head,
			slot: S.lens,
			r: [h * k, 0.0035 * k],
			ref: Y_,
			sides: 6,
			samples: 10,
		});
		if (style === 'wrap')
			// prettier-ignore
			sweep(mb, pts.map((p) => p.clone().add(V(0.0015 * k, h * k, 0))), { bone: B.head, slot: S.glasses, r: [0.003 * k, 0.0045 * k], ref: Y_, sides: 4, samples: 10 });
		for (const s of [1, -1])
			// prettier-ignore
			tube(mb, V(K.x + 0.036 * k, eyeY + 0.008 * k, s * 0.087 * k), V(K.x - 0.04 * k, eyeY + 0.012 * k, s * 0.083 * k), 0.003 * k, { bone: B.head, slot: S.glasses, sides: 4 });
	} else if (style === 'round')
		for (const s of [1, -1]) {
			const c = V(K.x + 0.09 * k, eyeY, s * 0.033 * k);
			// prettier-ignore
			mb.geo(new THREE.CylinderGeometry(0.019 * k, 0.019 * k, 0.003 * k, 12).rotateZ(Math.PI / 2), B.head, S.lens, TR(c.x, c.y, c.z));
			// prettier-ignore
			mb.geo(new THREE.TorusGeometry(0.019 * k, 0.0024 * k, 4, 14).rotateY(Math.PI / 2), B.head, S.glasses, TR(c.x + 0.001, c.y, c.z));
			// prettier-ignore
			tube(mb, c.clone().add(V(-0.005 * k, 0.004 * k, s * 0.018 * k)), V(K.x - 0.04 * k, eyeY + 0.01 * k, s * 0.083 * k), 0.0022 * k, { bone: B.head, slot: S.glasses, sides: 4 });
		}
}

export function buildHead(mb: MeshBuilder, d: RiderDims, kit: Kit): void {
	const kN = d.k;
	const b = d.build;
	const k = d.k * HEAD_SCALE;
	const K = V(0.07 * k, 0.13 * k, 0); // skull centre
	const q0 = new THREE.Quaternion();
	// prettier-ignore
	sweep(mb, [V(-0.012 * kN, -0.02 * kN, 0), V(0.025 * kN, 0.05 * kN, 0), V(0.055 * kN, 0.095 * kN, 0)], { bone: B.head, slot: S.skin, r: (t) => lerp(0.056, 0.046, t) * kN * b, sides: 12, samples: 6 });
	ell(mb, B.head, S.skin, K, 0.086 * k, 0.09 * k, 0.078 * k, undefined, {
		w: 10,
		h: 7,
	});
	// prettier-ignore
	ell(mb, B.head, S.skin, K.clone().add(V(0.034 * k, -0.046 * k, 0)), 0.058 * k, 0.066 * k, 0.064 * k, qAxis(Z_, 0.22), { w: 10, h: 7 }); // jaw and cheeks
	// prettier-ignore
	ell(mb, B.head, S.skin, K.clone().add(V(0.064 * k, -0.097 * k, 0)), 0.019 * k, 0.015 * k, 0.025 * k, q0, { w: 8, h: 5 }); // chin
	// prettier-ignore
	ell(mb, B.head, S.skin, K.clone().add(V(0.093 * k, -0.014 * k, 0)), 0.016 * k, 0.022 * k, 0.012 * k, qAxis(Z_, -0.45), { w: 6, h: 5 }); // nose
	for (const s of [1, -1])
		// prettier-ignore
		ell(mb, B.head, S.skin, K.clone().add(V(-0.008 * k, -0.014 * k, s * 0.078 * k)), 0.017 * k, 0.026 * k, 0.011 * k, q0, { w: 6, h: 5 }); // ears
	if (kit.hair !== 'none')
		// prettier-ignore
		ell(mb, B.head, S.hair, K.clone().add(V(-0.03 * k, -0.018 * k, 0)), 0.074 * k, 0.07 * k, 0.082 * k, undefined, { w: 10, h: 6 });
	if (kit.hair === 'ponytail')
		// prettier-ignore
		sweep(mb, [K.clone().add(V(-0.085 * k, -0.005 * k, 0)), K.clone().add(V(-0.13 * k, -0.045 * k, 0)), K.clone().add(V(-0.15 * k, -0.11 * k, 0)), K.clone().add(V(-0.14 * k, -0.16 * k, 0))], { bone: B.head, slot: S.hair, r: (t) => lerp(0.026, 0.008, t) * k, sides: 8, samples: 8 });
	if (kit.helmet === 'hairnet') buildHairnet(mb, K, k);
	else buildShell(mb, K, k, kit.helmet === 'aero');
	buildGlasses(mb, K, k, kit.glasses);
}
