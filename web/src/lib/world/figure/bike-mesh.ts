import * as THREE from 'three';
import { FRAMES, type Cockpit } from './bikes/presets';
import { buildBars, buildExtras } from './bike-parts';
import { B, S } from './contract';
import type { FrameTubes, Kit } from './kit';
import { curve, lerp, V, Y_, Z_ } from './math';
import type { MeshBuilder } from './mesh';
import { revolve } from './revolve';
import type { Rig } from './rig';
import {
	axisLoft,
	place,
	qAxis,
	qFromTo,
	sweep,
	TR,
	type Station,
} from './shapes';

/**
 * The bike under a figure (#3070): frame and stays on the bike bone, fork and
 * cockpit on the fork bone so they steer, the saddle where the fit put it,
 * and each frame's own parts — cages, fenders, rack, bag, bell, lamp, brakes.
 */

const sphere = (r: number, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);

function frameTube(
	mb: MeshBuilder,
	a: THREE.Vector3,
	b: THREE.Vector3,
	r: number,
	t: FrameTubes,
	o: { bone?: number; slot?: number; round?: boolean; lugs?: boolean } = {},
): void {
	const shape = t.shape === 'kamm' ? 'kamm' : 'ellipse';
	const aspect =
		t.shape === 'kamm' || t.shape === 'aero' ? (t.aspect ?? 1.8) : 1;
	const dir = b.clone().sub(a).normalize();
	// The major axis stays in the bike's plane.
	const ref =
		Math.abs(dir.z) > 0.9 ? Y_ : V().crossVectors(Z_, dir).normalize();
	const bone = o.bone ?? B.bike;
	// prettier-ignore
	sweep(mb, [a, b], { bone, slot: o.slot ?? S.frame, r: o.round ? r : [r * aspect, r], shape: o.round ? 'ellipse' : shape, ref, sides: aspect > 1.2 ? 12 : 10 });
	if (t.lugs && o.lugs !== false)
		for (const [p, q] of [
			[a, dir],
			[b, dir.clone().negate()],
		]) {
			const c = p.clone().addScaledVector(q, 0.022);
			// prettier-ignore
			sweep(mb, [p.clone().addScaledVector(q, 0.004), c.addScaledVector(q, 0.012)], { bone, slot: t.lugContrast ? S.frameAccent : S.frame, r: (u) => r * lerp(1.32, 1.08, u), ref, sides: 10 });
		}
}

export function buildBike(mb: MeshBuilder, rig: Rig, kit: Kit): void {
	const { bk, fit } = rig;
	const t = kit.tubes;
	const parts = kit.parts;
	const lod = mb.lod;
	const cockpit: Cockpit = FRAMES[kit.frame].cockpit;
	const quill = cockpit.stemStyle === 'quill';
	// --- frame (bike bone)
	const ssTop =
		t.stays === 'dropped'
			? bk.bb
					.clone()
					.addScaledVector(bk.stDir, bk.clusterLen - (t.dropY ?? 0.08))
			: bk.cluster.clone().addScaledVector(bk.stDir, -0.018);
	frameTube(mb, bk.dtFront, bk.bb, t.dt, t);
	frameTube(mb, bk.ttFront, bk.cluster, t.tt, t);
	frameTube(
		mb,
		bk.bb,
		bk.cluster.clone().addScaledVector(bk.stDir, 0.035),
		t.st,
		t,
	);
	// prettier-ignore
	sweep(mb, [bk.htTop.clone().addScaledVector(bk.up, 0.012), bk.htBot.clone().addScaledVector(bk.down, 0.014)], { bone: B.bike, slot: S.frame, r: (u) => t.ht * lerp(0.92, t.shape === 'steel' ? 1.02 : 1.14, u), sides: 14 });
	if (t.lugs)
		for (const p of [bk.htTop, bk.htBot])
			// prettier-ignore
			sweep(mb, [p.clone().addScaledVector(bk.up, 0.018), p.clone().addScaledVector(bk.down, 0.018)], { bone: B.bike, slot: t.lugContrast ? S.frameAccent : S.frame, r: t.ht * 1.22, sides: 14 });
	// Head-tube accent band, seat collar and the bottom-bracket shell.
	// prettier-ignore
	sweep(mb, [bk.htTop.clone().addScaledVector(bk.up, 0.013), bk.htTop.clone().addScaledVector(bk.down, 0.02)], { bone: B.bike, slot: S.frameAccent, r: t.ht * 1.03, sides: 14, cap: false });
	// prettier-ignore
	sweep(mb, [bk.cluster.clone().addScaledVector(bk.stDir, 0.02), bk.cluster.clone().addScaledVector(bk.stDir, 0.045)], { bone: B.bike, slot: S.frameAccent, r: t.st * 1.18, sides: 10 });
	sweep(mb, [bk.bb.clone().setZ(-0.036), bk.bb.clone().setZ(0.036)], {
		bone: B.bike,
		slot: S.frame,
		r: 0.021,
		sides: 12,
		ref: Y_,
	});
	const stays = {
		...t,
		shape: t.shape === 'kamm' ? ('aero' as const) : t.shape,
	};
	for (const s of [1, -1]) {
		const drop = bk.rear.clone().setZ(0.066 * s);
		frameTube(
			mb,
			bk.bb.clone().add(V(-0.012, 0, 0.034 * s)),
			drop.clone().add(V(0.012, 0, 0)),
			t.cs,
			stays,
			{ lugs: false },
		);
		frameTube(
			mb,
			drop.clone().add(V(0.004, 0.012, 0)),
			ssTop.clone().setZ(0.021 * s),
			t.ss,
			{ ...stays, aspect: 1.4 },
			{ lugs: false },
		);
		// prettier-ignore
		mb.geo(new THREE.CylinderGeometry(0.019, 0.019, 0.006, 10, 1).rotateX(Math.PI / 2), B.bike, S.frame, TR(drop.x + 0.006, drop.y + 0.002, drop.z));
	}
	// --- fork (fork bone): crown, then curved blades to the offset axle
	const nrm = V(Math.sin(bk.hta), Math.cos(bk.hta), 0);
	// prettier-ignore
	mb.geo(sphere(1, 10, 6), B.fork, S.frame, place(bk.htBot.clone().addScaledVector(bk.down, 0.02), qAxis(Z_, -(Math.PI / 2 - bk.hta)), V(0.03, 0.02, 0.05)));
	for (const s of [1, -1]) {
		const top = bk.htBot
			.clone()
			.addScaledVector(bk.down, 0.022)
			.setZ(0.042 * s);
		const axle = bk.front.clone().setZ(0.052 * s);
		const mid = bk.htBot
			.clone()
			.addScaledVector(bk.down, 0.2)
			.addScaledVector(nrm, 0.012)
			.setZ(0.05 * s);
		const r = (u: number): number | [number, number] => {
			const rr = t.fork * lerp(1.15, 0.7, u);
			return t.shape === 'round' || t.shape === 'steel' ? rr : [rr * 1.5, rr];
		};
		sweep(mb, [top, mid, axle.addScaledVector(bk.up, 0.02)], {
			bone: B.fork,
			slot: S.frame,
			r,
			samples: 6,
			ref: nrm,
			sides: 8,
		});
	}
	// --- cockpit (fork bone)
	// prettier-ignore
	sweep(mb, [bk.htTop.clone().addScaledVector(bk.up, 0.012), fit.steererTop.clone().addScaledVector(bk.up, 0.012)], { bone: B.fork, slot: quill ? S.metal : S.hood, r: quill ? 0.012 : 0.0165, sides: 12 });
	if (quill)
		sweep(
			mb,
			[fit.steererTop, fit.clampPt.clone().addScaledVector(fit.stemDir, 0.012)],
			{ bone: B.fork, slot: S.metal, r: 0.011, sides: 10 },
		);
	else
		// prettier-ignore
		sweep(mb, [fit.steererTop.clone().addScaledVector(fit.stemDir, -0.012), fit.clampPt.clone().addScaledVector(fit.stemDir, 0.018)], { bone: B.fork, slot: S.hood, r: [0.017, 0.02], ref: bk.up, sides: 10 });
	buildBars(mb, rig);
	// --- saddle and post (bike bone)
	const postTop = fit.contact.clone().addScaledVector(bk.stDir, -0.045);
	// prettier-ignore
	sweep(mb, [bk.cluster.clone().addScaledVector(bk.stDir, 0.02), postTop], { bone: B.bike, slot: t.shape === 'kamm' ? S.frame : S.metal, r: t.shape === 'kamm' ? [0.02, 0.011] : 0.0136, ref: V().crossVectors(Z_, bk.stDir), sides: 10 });
	buildSaddle(mb, rig, kit.saddle);
	// --- bottles
	const cages = Math.min(
		kit.bottles === 'two' ? 2 : kit.bottles === 'one' ? 1 : 0,
		parts.bottleCages,
	);
	const dtDir = bk.dtFront.clone().sub(bk.bb).normalize();
	const dtUp = V(-dtDir.y, dtDir.x, 0);
	const bottle = (
		base: THREE.Vector3,
		axis: THREE.Vector3,
		side: THREE.Vector3,
	) => {
		const m = place(
			base.clone().addScaledVector(side, 0.049),
			qFromTo(Z_, axis),
		);
		// prettier-ignore
		const prof = [[0.001, 0], [0.034, 0.002], [0.037, 0.02], [0.035, 0.09], [0.037, 0.15], [0.032, 0.18]].map(([r, z]) => ({ r, z, slot: S.bottle }))
			.concat([[0.032, 0.18], [0.02, 0.195], [0.008, 0.215], [0.001, 0.218]].map(([r, z]) => ({ r, z, slot: S.bottleCap })));
		revolve(mb, prof, B.bike, {
			m,
			segments: lod ? 8 : 12,
			outward: (p) => [p.r, p.z > 0.1 ? 1 : -1],
		});
		// The cage: two thin rails.
		for (const s of [1, -1])
			// prettier-ignore
			sweep(mb, [base.clone().addScaledVector(axis, 0.01).setZ(0.018 * s), base.clone().addScaledVector(axis, 0.07).addScaledVector(side, 0.02).setZ(0.03 * s), base.clone().addScaledVector(axis, 0.13).addScaledVector(side, 0.012).setZ(0.022 * s)], { bone: B.bike, slot: S.hood, r: 0.0025, sides: 4, samples: 4 });
	};
	if (cages >= 1)
		bottle(
			bk.bb.clone().addScaledVector(dtDir, 0.2).addScaledVector(dtUp, t.dt),
			dtDir,
			dtUp,
		);
	if (cages >= 2) {
		const fwd = V(Math.sin(bk.sta), Math.cos(bk.sta), 0);
		bottle(
			bk.bb.clone().addScaledVector(bk.stDir, 0.13).addScaledVector(fwd, t.st),
			bk.stDir,
			fwd,
		);
	}
	buildExtras(mb, rig, kit, ssTop, nrm);
}

function buildSaddle(mb: MeshBuilder, rig: Rig, style: Kit['saddle']): void {
	const c = rig.fit.contact; // the top-centre contact point
	const len = style === 'short' ? 0.24 : 0.27;
	const hwTail =
		style === 'leather' ? 0.085 : style === 'short' ? 0.074 : 0.068;
	const noseX = style === 'short' ? 0.1 : 0.15;
	const tailX = noseX - len;
	// prettier-ignore
	const hw = curve([[tailX, hwTail * 0.8], [tailX + 0.04, hwTail], [tailX + 0.1, hwTail * 0.92], [noseX - 0.1, style === 'short' ? 0.05 : 0.03], [noseX - 0.03, 0.022], [noseX, 0.012]]);
	// prettier-ignore
	const topY = curve([[tailX, 0.006], [tailX + 0.05, 0.002], [noseX - 0.1, -0.001], [noseX - 0.04, 0.0], [noseX, -0.004]]);
	const th = style === 'leather' ? 0.028 : 0.018;
	const N = mb.lod ? 6 : 9;
	const st: Station[] = [];
	for (let i = 0; i <= N; i++)
		st.push({
			t: tailX + (len * i) / N,
			slot: style === 'leather' ? S.leather : S.saddle,
		});
	const base = V(c.x + 0.035, c.y, 0); // the sit bones land just behind the saddle's middle
	// prettier-ignore
	axisLoft(mb, st, (x) => ({ c: V(base.x + x, base.y + topY(x) - th / 2, 0), u: Y_, v: Z_, ruP: th / 2, ruN: th / 2, rv: hw(x), n: 3 }), B.bike, { sides: 12, capStart: V(base.x + tailX - 0.004, base.y - th / 2, 0), capEnd: V(base.x + noseX + 0.004, base.y - th / 2 - 0.003, 0) });
	for (const s of [1, -1])
		// prettier-ignore
		sweep(mb, [V(base.x + tailX + 0.03, base.y - th + 0.002, 0.03 * s), V(base.x - 0.04, base.y - th - 0.018, 0.022 * s), V(base.x + noseX - 0.05, base.y - th - 0.012, 0.012 * s), V(base.x + noseX - 0.02, base.y - th + 0.003, 0.006 * s)], { bone: B.bike, slot: S.metal, r: 0.0035, sides: 4, samples: 6 });
	if (style === 'leather')
		for (const s of [1, -1])
			for (let i = 0; i < 3; i++) {
				// prettier-ignore
				mb.geo(new THREE.TorusGeometry(0.012, 0.003, 4, 8).rotateX(Math.PI / 2), B.bike, S.metal, TR(base.x + tailX + 0.035, base.y - th - 0.012 - i * 0.01, 0.045 * s));
				mb.geo(
					sphere(0.0035, 5, 3),
					B.bike,
					S.metal,
					TR(
						base.x + tailX + 0.02 + i * 0.03,
						base.y - 0.004,
						(hwTail - 0.006 - i * 0.008) * s,
					),
				);
			}
	mb.geo(
		new THREE.BoxGeometry(0.03, 0.02, 0.05),
		B.bike,
		S.metal,
		TR(base.x - 0.03, base.y - th - 0.018, 0),
	); // clamp
}
