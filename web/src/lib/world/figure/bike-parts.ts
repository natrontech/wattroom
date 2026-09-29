import * as THREE from 'three';
import { BARS } from './bikes/presets';
import { B, S } from './contract';
import type { Kit } from './kit';
import { lerp, TAU, V, Y_, Z_ } from './math';
import type { MeshBuilder } from './mesh';
import type { Rig } from './rig';
import { place, qAxis, sweep, TR, tube } from './shapes';

/**
 * The bike's own parts (#3070): bars in every style, and each frame's extras —
 * fenders, rack, bag, bell, lamp — and brakes. The frame, fork and saddle are
 * bike-mesh.ts's.
 */

/** The Ordonnanzrad's kit, and every frame's brakes. */
export function buildExtras(
	mb: MeshBuilder,
	rig: Rig,
	kit: Kit,
	ssTop: THREE.Vector3,
	nrm: THREE.Vector3,
): void {
	const { bk, fit } = rig;
	const parts = kit.parts;
	if (parts.fenders) {
		const arc = (c: THREE.Vector3, from: number, to: number, bone: number) => {
			const pts: THREE.Vector3[] = [];
			for (let i = 0; i <= 10; i++) {
				const a = lerp(from, to, i / 10);
				pts.push(
					c
						.clone()
						.add(
							V(Math.cos(a) * (bk.R + 0.03), Math.sin(a) * (bk.R + 0.03), 0),
						),
				);
			}
			sweep(mb, pts, {
				bone,
				slot: S.frame,
				r: [0.004, 0.028],
				ref: Z_,
				samples: 16,
				sides: 6,
			});
		};
		arc(bk.rear, -0.25, 2.2, B.bike);
		arc(bk.front, 0.35, 2.6, B.fork);
	}
	if (parts.rack) {
		const top = bk.rear.clone().add(V(0.02, bk.R + 0.07, 0));
		const rail = (
			a: THREE.Vector3,
			b: THREE.Vector3,
			r: number,
			sides: number,
		) => tube(mb, a, b, r, { bone: B.bike, slot: S.frame, sides });
		for (const s of [1, -1]) {
			rail(
				bk.rear.clone().add(V(0.0, 0.01, 0.07 * s)),
				top.clone().add(V(-0.12, 0, 0.07 * s)),
				0.0055,
				6,
			);
			rail(
				top.clone().add(V(-0.2, 0, 0.07 * s)),
				top.clone().add(V(0.14, 0, 0.07 * s)),
				0.006,
				6,
			);
			rail(
				top.clone().add(V(0.14, 0, 0.07 * s)),
				ssTop.clone().add(V(0.01, -0.01, 0.024 * s)),
				0.005,
				6,
			);
		}
		for (let i = 0; i < 4; i++)
			rail(
				top.clone().add(V(-0.18 + i * 0.1, 0, -0.07)),
				top.clone().add(V(-0.18 + i * 0.1, 0, 0.07)),
				0.004,
				5,
			);
	}
	if (parts.frameBag) {
		// prettier-ignore
		const tri = [bk.ttFront.clone().addScaledVector(bk.down, 0.03), bk.cluster.clone().addScaledVector(bk.stDir, -0.03), bk.bb.clone().addScaledVector(bk.stDir, 0.12), bk.dtFront.clone().addScaledVector(bk.dtFront.clone().sub(bk.bb).normalize(), -0.12)];
		const cen = tri.reduce((a, p) => a.add(p), V()).multiplyScalar(0.25);
		const shp = new THREE.Shape(
			tri.map(
				(p) =>
					new THREE.Vector2(lerp(p.x, cen.x, 0.12), lerp(p.y, cen.y, 0.12)),
			),
		);
		// prettier-ignore
		const g = new THREE.ExtrudeGeometry(shp, { depth: 0.05, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1, curveSegments: 1 });
		mb.geo(g, B.bike, S.leather, TR(0, 0, -0.025));
	}
	if (parts.bell)
		// prettier-ignore
		mb.geo(new THREE.SphereGeometry(0.022, 12, 6, 0, TAU, 0, Math.PI / 2), B.fork, S.metal, TR(fit.clampPt.x - 0.02, fit.clampPt.y + 0.03, -0.07));
	if (parts.lamp) {
		const c = bk.htBot
			.clone()
			.addScaledVector(bk.down, 0.05)
			.add(V(0.07, 0, 0));
		mb.geo(
			new THREE.CylinderGeometry(0.032, 0.028, 0.06, 14).rotateZ(Math.PI / 2),
			B.fork,
			S.frame,
			TR(c.x, c.y, c.z),
		);
		mb.geo(
			new THREE.CylinderGeometry(0.029, 0.029, 0.004, 14).rotateZ(Math.PI / 2),
			B.fork,
			S.lens,
			TR(c.x + 0.031, c.y, c.z),
		);
		tube(
			mb,
			bk.htBot.clone().addScaledVector(bk.down, 0.03),
			c.clone().add(V(-0.03, 0, 0)),
			0.005,
			{ bone: B.fork, slot: S.metal, sides: 5 },
		);
	}
	if (parts.brakes === 'rim') {
		const fc = bk.htBot
			.clone()
			.addScaledVector(bk.down, 0.035)
			.addScaledVector(nrm, 0.03);
		mb.geo(
			new THREE.BoxGeometry(0.02, 0.05, 0.07),
			B.fork,
			S.groupset,
			place(fc, qAxis(Z_, -(Math.PI / 2 - bk.hta))),
		);
		const rc = ssTop
			.clone()
			.addScaledVector(bk.rear.clone().sub(ssTop).normalize(), 0.05)
			.add(V(-0.012, 0, 0));
		mb.geo(
			new THREE.BoxGeometry(0.02, 0.045, 0.07),
			B.bike,
			S.groupset,
			TR(rc.x, rc.y, 0),
		);
	} else if (parts.brakes === 'disc') {
		mb.geo(
			new THREE.BoxGeometry(0.05, 0.028, 0.02),
			B.fork,
			S.groupset,
			TR(bk.front.x - 0.035, bk.front.y + 0.055, -0.058),
		);
		mb.geo(
			new THREE.BoxGeometry(0.05, 0.028, 0.02),
			B.bike,
			S.groupset,
			TR(bk.rear.x + 0.06, bk.rear.y + 0.03, -0.058),
		);
	}
}

export function buildBars(mb: MeshBuilder, rig: Rig): void {
	const { fit, style } = rig;
	const C = fit.clampPt;
	const P = (x: number, y: number, z: number) => V(C.x + x, C.y + y, z);
	const tape = S.barTape;
	const bone = B.fork;
	sweep(mb, [P(0, 0, -0.024), P(0, 0, 0.024)], {
		bone,
		slot: S.hood,
		r: 0.02,
		sides: 10,
		ref: Y_,
	}); // stem clamp
	const bar = BARS[style];
	if (
		style === 'drop' ||
		style === 'aero' ||
		style === 'flare' ||
		style === 'track'
	) {
		const flare = style === 'flare' ? 0.045 : 0;
		const deep = style === 'track' ? 1.2 : 1;
		const reachX = style === 'track' ? 0.07 : 0.082;
		for (const s of [1, -1]) {
			// prettier-ignore
			const pts = [P(0, 0, 0.0), P(0.0, 0.002, 0.1 * s), P(0.03, 0.004, 0.16 * s), P(reachX - 0.004, 0.0, 0.195 * s), P(reachX + 0.012, -0.04 * deep, 0.2 * s), P(reachX - 0.01, -0.095 * deep, (0.2 + flare * 0.6) * s), P(-0.005, -0.118 * deep, (0.2 + flare) * s), P(-0.075, -0.112 * deep, (0.2 + flare * 1.1) * s)];
			if (style === 'aero') {
				sweep(mb, pts.slice(0, 4), {
					bone,
					slot: S.hood,
					r: (u) => [0.0075, lerp(0.022, 0.016, u)],
					ref: Y_,
					samples: 10,
					sides: 8,
					cap: false,
				});
				sweep(mb, pts.slice(3), {
					bone,
					slot: tape,
					r: 0.0125,
					samples: 12,
					sides: 7,
				});
			} else
				sweep(mb, pts, {
					bone,
					slot: (u) => (u < 0.13 ? S.hood : tape),
					r: 0.0122,
					samples: 20,
					sides: 7,
				});
			if (style !== 'track') {
				// The hood's body over the lever, and the lever's blade.
				const hb = P(reachX + 0.004, 0.004, 0.198 * s);
				const ht = P(bar.hoods[0] + 0.028, bar.hoods[1] + 0.012, 0.198 * s);
				// prettier-ignore
				sweep(mb, [hb, P((reachX + bar.hoods[0]) / 2 + 0.01, bar.hoods[1] + 0.006, 0.199 * s), ht], { bone, slot: S.hood, r: (u) => [lerp(0.017, 0.013, u) + 0.01 * Math.sin(u * Math.PI), 0.0135], ref: Y_, samples: 6, sides: 8 });
				// prettier-ignore
				sweep(mb, [P(bar.hoods[0] + 0.02, bar.hoods[1] - 0.004, 0.2 * s), P(bar.hoods[0] + 0.024, -0.05, 0.203 * s), P(bar.hoods[0] - 0.006, -0.1, 0.205 * s)], { bone, slot: S.groupset, r: [0.0045, 0.0075], ref: Z_, samples: 5, sides: 5 });
			}
		}
	} else if (style === 'tt' && fit.pad && fit.grips.extensions) {
		for (const s of [1, -1]) {
			// prettier-ignore
			sweep(mb, [P(0, 0, 0), P(0.02, -0.004, 0.1 * s), P(0.09, -0.016, 0.18 * s), P(0.16, -0.026, 0.2 * s), P(0.2, -0.03, 0.2 * s)], { bone, slot: (u) => (u > 0.6 ? tape : S.frame), r: (u) => (u > 0.6 ? 0.013 : [0.02, 0.007]), ref: Y_, samples: 18, sides: 8 });
			// The pad's riser, the pad, and the extension out to its tip.
			const padC = fit.pad.clone().setZ(0.085 * s);
			tube(
				mb,
				P(0.02, 0, 0.075 * s),
				padC.clone().add(V(0.0, -0.012, 0)),
				0.009,
				{ bone, slot: S.frame, sides: 8 },
			);
			// prettier-ignore
			mb.geo(new THREE.CapsuleGeometry(0.03, 0.07, 3, 10).rotateZ(Math.PI / 2).scale(1, 0.35, 1), bone, S.hood, TR(padC.x, padC.y - 0.006, padC.z));
			const tipR = fit.grips.extensions.R.p;
			const tip = V(tipR.x, tipR.y, tipR.z * s);
			// prettier-ignore
			sweep(mb, [padC.clone().add(V(-0.02, -0.03, -0.022 * s)), padC.clone().add(V(0.08, -0.026, -0.022 * s)), tip.clone().add(V(-0.03, -0.022, 0)), tip.clone().add(V(0.02, 0.005, 0))], { bone, slot: (u) => (u > 0.72 ? tape : S.frame), r: 0.0105, samples: 16, sides: 8 });
		}
	} else if (style === 'upright')
		for (const s of [1, -1]) {
			const g = bar.hoods;
			// prettier-ignore
			sweep(mb, [P(0, 0, 0), P(0.01, 0.012, 0.1 * s), P(-0.05, 0.05, 0.2 * s), P(g[0] + 0.02, g[1], (g[2] - 0.005) * s), P(g[0] - 0.07, g[1] + 0.004, (g[2] + 0.006) * s)], { bone, slot: S.metal, r: 0.011, samples: 20, sides: 8 });
			const gc = P(g[0], g[1], g[2] * s);
			const ax = V(-0.95, 0.02, 0.3 * s).normalize();
			sweep(
				mb,
				[
					gc.clone().addScaledVector(ax, -0.05),
					gc.clone().addScaledVector(ax, 0.07),
				],
				{ bone, slot: S.leather, r: 0.017, sides: 10 },
			);
		}
}
