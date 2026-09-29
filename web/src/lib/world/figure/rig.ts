import * as THREE from 'three';
import {
	fitRider,
	riderDims,
	toeDown,
	type Build,
	type GripName,
	type RiderDims,
} from './bikes/fit';
import { bikeGeometry, type Pt } from './bikes/geometry';
import { FRAMES, type BarStyle } from './bikes/presets';
import { B, BONES } from './contract';
import type { Kit } from './kit';
import { REST_FLEX } from './limbs';
import { V, Z_ } from './math';
import { TR } from './shapes';

/**
 * A figure's rig (#3070): the body's proportions, the frame's points and the
 * fit (#3069) in bike space as three.js vectors — +X forward, +Y up, +Z the
 * rider's right, origin on the ground under the bottom bracket — plus each
 * bone's rest transform and how far the bike may lean.
 */

const DEG = Math.PI / 180;
const v3 = (p: Pt, z = 0) => V(p.x, p.y, z);

export type Rig = {
	dims: RiderDims;
	style: BarStyle;
	bk: {
		R: number;
		/** The tyre's tube radius as drawn. */
		rt: number;
		bb: THREE.Vector3;
		rear: THREE.Vector3;
		front: THREE.Vector3;
		htTop: THREE.Vector3;
		htBot: THREE.Vector3;
		down: THREE.Vector3;
		up: THREE.Vector3;
		stDir: THREE.Vector3;
		cluster: THREE.Vector3;
		clusterLen: number;
		ttFront: THREE.Vector3;
		dtFront: THREE.Vector3;
		hta: number;
		sta: number;
	};
	fit: {
		crank: number;
		pedalZ: number;
		contact: THREE.Vector3;
		hipSeat: THREE.Vector3;
		hipStand: THREE.Vector3;
		steererTop: THREE.Vector3;
		clampPt: THREE.Vector3;
		stemDir: THREE.Vector3;
		pad: THREE.Vector3 | null;
		/** Right-hand grip centres; the left mirrors z. */
		grips: Partial<Record<GripName, THREE.Vector3>>;
	};
	/** The lean, radians, before a pedal or shoe meets the road: pedalling, and coasting with level cranks. */
	leanMax: { pedal: number; coast: number };
};

export function rigFor(
	kit: Kit,
	body: { height?: number; build?: Build } = {},
): Rig {
	const dims = riderDims(body.height, body.build);
	const frame = FRAMES[kit.frame];
	const fixed = frame.cockpit.bar;
	const style: BarStyle =
		fixed === 'tt' || fixed === 'upright' ? fixed : kit.bars;
	const g = bikeGeometry(frame.geometry, kit.tyres.widthMm, dims.k);
	const f = fitRider(dims, g, { ...frame.cockpit, bar: style });
	const grips: Rig['fit']['grips'] = {};
	for (const [name, pair] of Object.entries(f.grips))
		grips[name as GripName] = V(pair.R.p[0], pair.R.p[1], pair.R.p[2]);
	const rig: Rig = {
		dims,
		style,
		bk: {
			R: g.R,
			rt: g.tube,
			bb: v3(g.bb),
			rear: v3(g.rear),
			front: v3(g.front),
			htTop: v3(g.htTop),
			htBot: v3(g.htBot),
			down: v3(g.down),
			up: v3(g.up),
			stDir: v3(g.stDir),
			cluster: v3(g.cluster),
			clusterLen: g.clusterLen,
			ttFront: v3(g.ttFront),
			dtFront: v3(g.dtFront),
			hta: g.hta,
			sta: g.sta,
		},
		fit: {
			crank: f.crank,
			pedalZ: f.pedalZ,
			contact: v3(f.contact),
			hipSeat: v3(f.hipSeat),
			hipStand: v3(f.hipStand),
			steererTop: v3(f.steererTop),
			clampPt: v3(f.clampPt),
			stemDir: v3(f.stemDir),
			pad: f.pad ? v3(f.pad) : null,
			grips,
		},
		leanMax: { pedal: 0, coast: 0 },
	};
	rig.leanMax = leanLimits(rig);
	return rig;
}

/** Each bone's rest transform: the shins and forearms rest bent at REST_FLEX, everything else at the origin. */
export function restMatrices(d: RiderDims): THREE.Matrix4[] {
	const rest = BONES.map(() => new THREE.Matrix4());
	for (const n of [B.shinL, B.shinR])
		rest[n] = TR(0, -d.thigh, 0).multiply(
			new THREE.Matrix4().makeRotationZ(-REST_FLEX.knee),
		);
	for (const n of [B.foreL, B.foreR])
		rest[n] = TR(0, -d.upperArm, 0).multiply(
			new THREE.Matrix4().makeRotationZ(-REST_FLEX.elbow),
		);
	return rest;
}

/** How far the bike can lean before a pedal or shoe touches the road: pedalling (inside crank at the bottom), and coasting (level cranks). */
function leanLimits(rig: Rig): Rig['leanMax'] {
	const { dims: d, bk, fit } = rig;
	const k = d.k;
	// The shoe's lowest corners and the pedal's, in foot-local space.
	// prettier-ignore
	const pts = [V(0.2 * k, -0.07 * k, 0.03), V(0.2 * k, -0.07 * k, -0.03), V(0.15 * k, -0.078 * k, 0.046), V(-0.06 * k, -0.078 * k, 0.04), V(d.cleat.x + 0.046, d.cleat.y - 0.01, 0.034), V(d.cleat.x - 0.042, d.cleat.y - 0.01, 0.034)];
	const cleat = V(d.cleat.x, d.cleat.y, 0);
	const lowest = (a: number, lean: number) => {
		const q = new THREE.Quaternion().setFromAxisAngle(
			Z_,
			-toeDown(a + Math.PI / 2),
		);
		const spindle = V(
			bk.bb.x + fit.crank * Math.cos(a),
			bk.bb.y - fit.crank * Math.sin(a),
			fit.pedalZ,
		);
		const ankle = spindle.sub(cleat.clone().applyQuaternion(q));
		let lo = Infinity;
		for (const p of pts) {
			const w = p.clone().applyQuaternion(q).add(ankle);
			const z = Math.abs(w.z) + 0.01;
			lo = Math.min(
				lo,
				(w.y - bk.rt) * Math.cos(lean) - z * Math.sin(lean) + bk.rt,
			);
		}
		return lo;
	};
	const maxLean = (a: number) => {
		let lo = 0;
		let hi = 45 * DEG;
		for (let i = 0; i < 30; i++) {
			const m = (lo + hi) / 2;
			if (lowest(a, m) > 0.02) lo = m;
			else hi = m;
		}
		return lo;
	};
	return {
		pedal: Math.min(maxLean(Math.PI / 2), 28 * DEG),
		coast: Math.min(maxLean(0), maxLean(Math.PI), 32 * DEG),
	};
}
