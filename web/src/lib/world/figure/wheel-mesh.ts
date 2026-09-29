import * as THREE from 'three';
import { B, S, SP, type Aux } from './contract';
import type { Kit } from './kit';
import { TAU, V, Y_, Z_ } from './math';
import type { MeshBuilder, ProfilePoint } from './mesh';
import { revolve } from './revolve';
import type { Rig } from './rig';
import { place, qAxis, sweep, TR, tube } from './shapes';

/**
 * What turns (#3070): the crank on its own bone, the chain runs on the bike,
 * and each wheel on its own bone — tyre, rim, hub, and spokes or blades as a
 * shader disc so they never strobe (#3073 paints them).
 */

const DEG = Math.PI / 180;
/** ISO 622 bead seat, metres. */
const BEAD = 0.311;

const ring = (pts: [number, number][], slot: number): ProfilePoint[] =>
	pts.map(([r, z]) => ({ r, z, slot }));

export function buildDrivetrain(mb: MeshBuilder, rig: Rig, kit: Kit): void {
	const { bk, fit } = rig;
	const parts = kit.parts;
	const c = fit.crank;
	const grp = S.groupset;
	const seg = mb.lod ? 14 : 24;
	// Crank bone: rings, spider, arms and spindles. The right arm lies along +X,
	// the left along −X: each points at its pedal.
	// prettier-ignore
	revolve(mb, [{ r: 0.086, z: 0.0538, slot: grp }, { r: 0.1015, z: 0.0538, slot: grp }, { r: 0.1015, z: 0.0525, slot: S.chain }, { r: 0.107, z: 0.0525, slot: S.chain }, { r: 0.107, z: 0.0595, slot: S.chain }, { r: 0.1015, z: 0.0595, slot: S.chain }, { r: 0.1015, z: 0.0582, slot: grp }, { r: 0.086, z: 0.0582, slot: grp }], B.crank, { closed: true, segments: seg });
	if (parts.rings > 1)
		revolve(
			mb,
			ring(
				[
					[0.07, 0.047],
					[0.083, 0.047],
					[0.083, 0.051],
					[0.07, 0.051],
				],
				grp,
			),
			B.crank,
			{ closed: true, segments: seg },
		);
	for (let i = 0; i < 4; i++) {
		const a = (i / 4) * TAU + Math.PI / 4;
		// prettier-ignore
		mb.geo(new THREE.BoxGeometry(0.075, 0.016, 0.006), B.crank, grp, place(V(Math.cos(a) * 0.045, Math.sin(a) * 0.045, 0.06), qAxis(Z_, a)));
	}
	for (const s of [1, -1]) {
		const zA = 0.069 * s;
		sweep(mb, [V(0, 0, zA), V(s * c, 0, zA)], {
			bone: B.crank,
			slot: grp,
			r: (u) => [0.017 + (0.011 - 0.017) * u, 0.0062],
			ref: Y_,
			sides: 10,
		});
		// prettier-ignore
		sweep(mb, [V(s * c, 0, 0.074 * s), V(s * c, 0, (fit.pedalZ - 0.036) * s)], { bone: B.crank, slot: S.metal, r: 0.0055, sides: 6, ref: Y_ });
	}
	sweep(mb, [V(0, 0, -0.07), V(0, 0, 0.07)], {
		bone: B.crank,
		slot: S.metal,
		r: 0.012,
		sides: 8,
		ref: Y_,
	});
	// The chain runs on the bike bone, static by design: the spider shows the rotation.
	const cogR = parts.derailleur ? 0.045 : 0.04;
	const links = (a: THREE.Vector3, b: THREE.Vector3) =>
		sweep(mb, [a, b], {
			bone: B.bike,
			slot: S.chain,
			r: [0.0045, 0.0035],
			ref: Y_,
			sides: 6,
		});
	links(
		bk.bb.clone().add(V(0, 0.105, 0.056)),
		bk.rear.clone().add(V(0, cogR, 0.04)),
	);
	if (parts.derailleur) {
		const jockey = bk.rear.clone().add(V(0.012, -0.078, 0.052));
		links(bk.bb.clone().add(V(0, -0.105, 0.056)), jockey);
		// prettier-ignore
		sweep(mb, [bk.rear.clone().add(V(0.004, -0.012, 0.07)), bk.rear.clone().add(V(0.01, -0.045, 0.072)), jockey.clone().setZ(0.066)], { bone: B.bike, slot: grp, r: [0.012, 0.007], ref: Z_, samples: 6, sides: 8 });
		const pulley = () =>
			new THREE.CylinderGeometry(0.011, 0.011, 0.008, 12).rotateX(Math.PI / 2);
		mb.geo(pulley(), B.bike, S.hood, TR(jockey.x, jockey.y, 0.056));
		mb.geo(
			pulley(),
			B.bike,
			S.hood,
			TR(jockey.x + 0.006, jockey.y + 0.05, 0.056),
		);
		if (parts.rings > 1) {
			const fd = bk.bb.clone().addScaledVector(bk.stDir, 0.16);
			mb.geo(
				new THREE.BoxGeometry(0.05, 0.014, 0.02),
				B.bike,
				grp,
				TR(fd.x + 0.018, fd.y - 0.012, 0.05),
			);
		}
	} else
		links(
			bk.bb.clone().add(V(0, -0.105, 0.056)),
			bk.rear.clone().add(V(0, -cogR, 0.04)),
		);
	if (parts.brakes === 'coaster')
		tube(
			mb,
			bk.rear.clone().setZ(-0.06),
			bk.rear.clone().add(V(0.16, -0.02, -0.058)),
			0.006,
			{ bone: B.bike, slot: S.metal, sides: 6 },
		);
}

export function buildWheel(
	mb: MeshBuilder,
	rig: Rig,
	kit: Kit,
	which: 'front' | 'rear',
): void {
	const bone = which === 'front' ? B.frontWheel : B.rearWheel;
	const { bk } = rig;
	const w = kit.wheels[which];
	const dec = kit.wheels.decal;
	const seg = mb.lod ? 18 : 32;
	const R = bk.R;
	const rt = bk.rt;
	// The tyre: a circle in section, the tread band on top; the walls may be tan.
	const Rc = R - rt;
	const nT = mb.lod ? 5 : 8;
	const prof: ProfilePoint[] = [];
	for (let i = 0; i <= nT; i++) {
		const beta = -Math.PI * 0.62 + (i / nT) * Math.PI * 1.24; // skips what hides inside the rim
		const onTread = Math.abs(beta) < 0.62;
		const slot = onTread || kit.tyres.wall !== 'tan' ? S.tyre : S.tyreWall;
		prof.push({ r: Rc + rt * Math.cos(beta), z: rt * Math.sin(beta), slot });
	}
	// A seam between tread and wall, so a tan wall keeps a crisp edge.
	const seamed: ProfilePoint[] = [];
	for (let i = 0; i < prof.length; i++) {
		if (i > 0 && prof[i].slot !== prof[i - 1].slot)
			seamed.push({ ...prof[i - 1], slot: prof[i].slot });
		seamed.push(prof[i]);
	}
	revolve(mb, seamed, bone, { segments: seg, outward: (p) => [p.r - Rc, p.z] });
	// Knobs sit ON the tread circle, so the tyre still meets the road at full lean.
	if (kit.tyres.tread === 'knob') {
		const n = mb.lod ? 14 : 24;
		for (let i = 0; i < n; i++) {
			const a = (i / n) * TAU;
			const beta = (i % 2 ? 1 : -1) * 0.42;
			const rr = Rc + (rt - 0.0011) * Math.cos(beta);
			const zz = (rt - 0.0011) * Math.sin(beta);
			const q = new THREE.Quaternion().setFromEuler(
				new THREE.Euler(-beta, 0, a, 'ZYX'),
			);
			mb.geo(
				new THREE.BoxGeometry(0.009, 0.0035, 0.007),
				bone,
				S.tyre,
				place(V(Math.cos(a) * rr, Math.sin(a) * rr, zz), q),
			);
		}
	}
	const rimW = 0.013 + rt * 0.25;
	// Flat varyings: every aux change sits on a duplicated profile point.
	const decal: Aux = [SP.decal, dec.count, dec.arcDeg * DEG];
	if (w.type === 'disc') {
		const hz = 0.03;
		// prettier-ignore
		const dprof: ProfilePoint[] = [{ r: 0.03, z: hz, slot: S.rim, aux: decal }, { r: BEAD - 0.02, z: rimW * 0.95, slot: S.rim, aux: decal }, { r: BEAD - 0.02, z: rimW * 0.95, slot: S.rim }, { r: BEAD, z: rimW * 0.8, slot: S.rim }, { r: BEAD, z: -rimW * 0.8, slot: S.rim }, { r: BEAD - 0.02, z: -rimW * 0.95, slot: S.rim }, { r: BEAD - 0.02, z: -rimW * 0.95, slot: S.rim, aux: decal }, { r: 0.03, z: -hz, slot: S.rim, aux: decal }];
		revolve(mb, dprof, bone, {
			segments: seg,
			closed: true,
			outward: (p) => [p.r > BEAD - 0.001 ? 1 : 0, p.z],
		});
	} else {
		const ri = BEAD - w.depth;
		const bed = ri + w.depth * 0.18;
		// prettier-ignore
		const rprof: ProfilePoint[] = [{ r: ri, z: 0, slot: S.rim }, { r: bed, z: rimW * 0.8, slot: S.rim }, { r: bed, z: rimW * 0.8, slot: S.rim, aux: decal }, { r: BEAD, z: rimW, slot: S.rim, aux: decal }, { r: BEAD, z: rimW, slot: S.rim }, { r: BEAD, z: -rimW, slot: S.rim }, { r: BEAD, z: -rimW, slot: S.rim, aux: decal }, { r: bed, z: -rimW * 0.8, slot: S.rim, aux: decal }, { r: bed, z: -rimW * 0.8, slot: S.rim }];
		revolve(mb, rprof, bone, {
			segments: seg,
			closed: true,
			outward: (p) => [p.r - (ri + w.depth * 0.5), p.z],
		});
		// Spokes or blades: one shader disc a side, hub flange to rim bed (alpha-to-coverage, never strobes).
		const blades = w.type === 'blades';
		const aux: Aux = blades
			? [SP.blades, w.blades, w.bladeMm]
			: [SP.spokes, w.spokes, 2.2];
		for (const s of [1, -1]) {
			const z = s * (blades ? 0.012 : 0.017);
			// prettier-ignore
			revolve(mb, [{ r: 0.024, z, slot: S.spokes, aux, n: [0, s] }, { r: ri + 0.002, z: z * 0.35, slot: S.spokes, aux, n: [0, s] }], bone, { segments: seg });
		}
	}
	// The hub and its flanges; the cassette on the rear right, a rotor on the left.
	// prettier-ignore
	revolve(mb, ring([[0.001, -0.055], [0.014, -0.055], [0.028, -0.028], [0.016, -0.02], [0.016, 0.02], [0.028, 0.028], [0.014, 0.055], [0.001, 0.055]], S.metal), bone, { segments: mb.lod ? 8 : 12, outward: (p) => [p.r, p.z] });
	if (which === 'rear') {
		if (kit.parts.brakes === 'coaster')
			// prettier-ignore
			revolve(mb, ring([[0.001, -0.05], [0.034, -0.05], [0.036, 0], [0.034, 0.05], [0.001, 0.05]], S.metal), bone, { segments: 16, outward: (p) => [p.r, p.z] });
		// The cassette as one stepped cone; a single cog on a fixed or coaster bike.
		// prettier-ignore
		const cassette: [number, number][] = kit.parts.derailleur ? [[0.012, 0.024], [0.05, 0.024], [0.05, 0.03], [0.038, 0.033], [0.038, 0.04], [0.026, 0.043], [0.026, 0.05], [0.012, 0.05]] : [[0.012, 0.037], [0.04, 0.037], [0.04, 0.043], [0.012, 0.043]];
		revolve(mb, ring(cassette, S.groupset), bone, {
			segments: mb.lod ? 12 : 20,
			closed: true,
		});
	}
	if (kit.parts.brakes === 'disc')
		// prettier-ignore
		revolve(mb, ring([[0.058, -0.049], [0.08, -0.049], [0.08, -0.047], [0.058, -0.047]], S.metal), bone, { segments: mb.lod ? 12 : 20, closed: true });
}
