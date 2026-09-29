import * as THREE from 'three';
import type { RiderDims } from './bikes/fit';
import { B, S, SP, type Aux } from './contract';
import type { Kit } from './kit';
import { curve, sstep, TAU, V } from './math';
import type { MeshBuilder, Ring } from './mesh';
import { TR } from './shapes';

/**
 * The figure's limbs (#3070): tapered, lofted legs and arms, each ONE loft
 * smooth-skinned across the knee or elbow. Every size follows the rider's
 * height (k) and build (b); the profile knots are data, kept dense.
 */

const DEG = Math.PI / 180;
/** The joints' bind pose: mid-range keeps linear blend skinning honest. */
export const REST_FLEX = { knee: 70 * DEG, elbow: 40 * DEG };

type Profile = { xP: number; xN: number; z: number };
type LimbStation = { s: number; slot: number; aux?: Aux; seam?: boolean };
type Limb = {
	a: number;
	b: number;
	L1: number;
	L2: number;
	restFlex: number;
	band: number;
	prof: (s: number) => Profile;
	sides: number;
	stations: LimbStation[];
	side: number;
	capEnd: number;
};

/** A two-bone limb as ONE loft, bent at rest and blended over ±band across the joint. */
function limb(mb: MeshBuilder, o: Limb): void {
	const Fs = TR(0, -o.L1, 0).multiply(
		new THREE.Matrix4().makeRotationZ(-o.restFlex),
	);
	const n = Math.max(8, Math.round(o.sides * (mb.lod ? 0.6 : 1)));
	const off = V();
	const rings: Ring[] = o.stations.map((st) => {
		const w = sstep(o.L1 - o.band, o.L1 + o.band, st.s);
		const pr = o.prof(st.s);
		const pts: THREE.Vector3[] = [];
		const pcs: THREE.Vector3[] = [];
		for (let j = 0; j < n; j++) {
			const ph = (j / n) * TAU;
			const c = Math.cos(ph);
			off.set(c * (c >= 0 ? pr.xP : pr.xN), 0, Math.sin(ph) * pr.z);
			const pA = V(0, -st.s, 0).add(off);
			const pB = V(0, -(st.s - o.L1), 0)
				.add(off)
				.applyMatrix4(Fs);
			pts.push(pA.lerp(pB, w));
			pcs.push(V(st.s / (o.L1 + o.L2), ph / TAU, o.side));
		}
		const cB = V(0, -(st.s - o.L1), 0).applyMatrix4(Fs);
		const c = V(0, -st.s, 0).lerp(cB, w);
		return {
			pts,
			pc: pcs,
			c,
			bones: [o.a, o.b],
			w: [1 - w, w],
			slot: st.slot,
			aux: st.aux,
			seam: st.seam,
		};
	});
	const last = o.stations[o.stations.length - 1].s;
	mb.loft(rings, {
		capStart: V(0, -o.stations[0].s + 0.003, 0),
		capEnd: V(0, -(last - o.L1) - o.capEnd, 0).applyMatrix4(Fs),
	});
}

type Band = { from: number; slot: number; aux?: Aux };

/** Stations from s0 to s1, with a duplicated seam wherever the colour changes. */
function stationsFor(
	s0: number,
	s1: number,
	n: number,
	bands: Band[],
): LimbStation[] {
	const cuts = new Set<number>();
	for (let i = 0; i <= n; i++) cuts.add(+(s0 + ((s1 - s0) * i) / n).toFixed(5));
	for (const b of bands)
		if (b.from > s0 && b.from < s1) cuts.add(+b.from.toFixed(5));
	const bandAt = (s: number) => {
		let r = bands[0];
		for (const b of bands) if (s >= b.from - 1e-7) r = b;
		return r;
	};
	const out: LimbStation[] = [];
	for (const s of [...cuts].sort((x, y) => x - y)) {
		if (bands.some((b) => Math.abs(b.from - s) < 1e-6 && b.from > s0)) {
			const before = bandAt(s - 1e-4);
			const after = bandAt(s + 1e-6);
			out.push({ s, slot: before.slot, aux: before.aux });
			out.push({ s, slot: after.slot, aux: after.aux, seam: true });
		} else {
			const b = bandAt(s);
			out.push({ s, slot: b.slot, aux: b.aux });
		}
	}
	return out;
}

export function buildLegs(mb: MeshBuilder, d: RiderDims, kit: Kit): void {
	const { k, build: b } = d;
	const L1 = d.thigh;
	const L2 = d.shin;
	// prettier-ignore
	const thigh = curve([[-0.05 * k, 0.078], [0, 0.08], [0.12 * k, 0.078], [0.26 * k, 0.067], [0.37 * k, 0.056], [L1, 0.048], [L1 + 0.05 * k, 0.045], [L1 + 0.14 * k, 0.044], [L1 + 0.28 * k, 0.036], [L1 + L2 - 0.05 * k, 0.027], [L1 + L2, 0.03]]);
	// prettier-ignore
	const calf = curve([[L1 + 0.02 * k, 0], [L1 + 0.12 * k, 0.027], [L1 + 0.22 * k, 0.017], [L1 + 0.34 * k, 0]]);
	// prettier-ignore
	const quad = curve([[0.02 * k, 0], [0.15 * k, 0.013], [0.3 * k, 0.006], [L1 - 0.03 * k, 0.008], [L1 + 0.005, 0.011], [L1 + 0.05 * k, 0]]);
	const cap = 0.08 * b * k;
	const prof = (s: number): Profile => {
		if (s < 0) {
			const r = Math.sqrt(Math.max(cap * cap - s * s, 1e-6));
			return { xP: r, xN: r, z: r * 0.97 };
		}
		const r = thigh(s) * b * k;
		return {
			xP: r + quad(s) * b * k,
			xN: r + calf(s) * b * k,
			z: r * (s < L1 ? 0.95 : 0.92),
		};
	};
	const shortsEnd = kit.shorts === 'knicker' ? L1 + 0.13 * k : 0.8 * L1;
	const sockH = kit.socks.height * k;
	const bands: Band[] = [
		{ from: -cap, slot: S.shorts },
		{ from: shortsEnd, slot: S.shortsAccent },
		{ from: shortsEnd + 0.035 * k, slot: S.skin },
		{ from: L1 + L2 - sockH, slot: S.sock },
	];
	if (kit.socks.stripe)
		bands.push(
			{ from: L1 + L2 - sockH + 0.02 * k, slot: S.sockAccent },
			{ from: L1 + L2 - sockH + 0.045 * k, slot: S.sock },
		);
	bands.sort((x, y) => x.from - y.from);
	const stations = stationsFor(-cap + 0.004, L1 + L2, mb.lod ? 10 : 18, bands);
	for (const [side, a, bb] of [
		[1, B.thighR, B.shinR],
		[-1, B.thighL, B.shinL],
	])
		// prettier-ignore
		limb(mb, { a, b: bb, L1, L2, restFlex: REST_FLEX.knee, band: 0.05 * k, prof, sides: 12, stations, side, capEnd: 0.028 * k });
}

export function buildArms(mb: MeshBuilder, d: RiderDims, kit: Kit): void {
	const { k, build: b } = d;
	const L1 = d.upperArm;
	const L2 = d.foreArm;
	// prettier-ignore
	const r = curve([[-0.06 * k, 0.056], [0, 0.058], [0.06 * k, 0.054], [0.15 * k, 0.047], [0.25 * k, 0.042], [L1, 0.036], [L1 + 0.05 * k, 0.041], [L1 + 0.12 * k, 0.036], [L1 + L2 - 0.02 * k, 0.026], [L1 + L2, 0.027]]);
	// prettier-ignore
	const bic = curve([[0.05 * k, 0], [0.15 * k, 0.011], [0.26 * k, 0], [L1 + 0.02 * k, 0], [L1 + 0.07 * k, 0.006], [L1 + 0.15 * k, 0]]);
	const cap = 0.058 * b * k;
	const prof = (s: number): Profile => {
		if (s < 0) {
			const rr = Math.sqrt(Math.max(cap * cap - s * s, 1e-6));
			return { xP: rr, xN: rr, z: rr };
		}
		const rr = r(s) * b * k;
		return { xP: rr, xN: rr + bic(s) * b * k, z: rr * 0.95 };
	};
	const long = kit.jersey.sleeves === 'long';
	const sleeveEnd = long ? L1 + L2 - 0.03 * k : 0.44 * L1;
	const bands: Band[] = [
		{ from: -cap, slot: S.jersey, aux: [SP.sleeve, 0, 0] },
		{ from: sleeveEnd, slot: S.jerseyAccent },
		{ from: sleeveEnd + 0.03 * k, slot: long ? S.glove : S.skin },
	];
	const stations = stationsFor(-cap + 0.004, L1 + L2, mb.lod ? 8 : 14, bands);
	for (const [side, a, bb] of [
		[1, B.armR, B.foreR],
		[-1, B.armL, B.foreL],
	])
		// prettier-ignore
		limb(mb, { a, b: bb, L1, L2, restFlex: REST_FLEX.elbow, band: 0.045 * k, prof, sides: 10, stations, side, capEnd: 0.022 * k });
}
