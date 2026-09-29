// The bike under a rider: frame tubes, bars, stem, saddle, two wheels with
// a decal each (rotation reads at low speed) and the cranks.
import * as THREE from 'three';
import { B, capsule, part, S, type Detail, type V3 } from './rider-rig';

const tube = (pts: readonly V3[], r: number, radial: number, seg: number) =>
	new THREE.TubeGeometry(
		new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))),
		seg,
		r,
		radial,
		false,
	);
const FRAME: readonly (readonly V3[])[] = [
	[
		[-0.2, 0.93, 0],
		[0.5, 0.86, 0],
	],
	[
		[0, 0.27, 0],
		[-0.21, 0.95, 0],
	],
	[
		[0, 0.27, 0],
		[0.5, 0.8, 0],
	],
	[
		[0, 0.27, 0.03],
		[-0.41, 0.34, 0.03],
	],
	[
		[0, 0.27, -0.03],
		[-0.41, 0.34, -0.03],
	],
	[
		[-0.19, 0.88, 0.03],
		[-0.41, 0.34, 0.03],
	],
	[
		[-0.19, 0.88, -0.03],
		[-0.41, 0.34, -0.03],
	],
	[
		[0.5, 0.88, 0],
		[0.54, 0.7, 0],
		[0.59, 0.34, 0],
	],
];

export function bikeParts(q: Detail): THREE.BufferGeometry[] {
	const p: THREE.BufferGeometry[] = [];
	for (const f of FRAME)
		p.push(part(tube(f, 0.022, q.tube, q.tseg), B.bike, S.frame));
	for (const z of [-0.2, 0.2])
		p.push(
			part(
				tube(
					[
						[0.5, 0.92, z],
						[0.62, 0.93, z],
						[0.66, 0.85, z],
						[0.6, 0.78, z],
						[0.55, 0.79, z],
					],
					0.016,
					q.tube,
					q.tseg * 2,
				),
				B.bike,
				S.metal,
			),
		);
	p.push(
		part(
			capsule(0.016, 0.4, q.cap, q.tube)
				.rotateX(Math.PI / 2)
				.translate(0.5, 0.92, 0),
			B.bike,
			S.metal,
		),
	);
	p.push(
		part(
			capsule(0.018, 0.08, q.cap, q.tube).rotateZ(-1.1).translate(0.49, 0.9, 0),
			B.bike,
			S.metal,
		),
	); // stem
	p.push(
		part(
			capsule(0.05, 0.18, q.cap, q.r)
				.rotateZ(Math.PI / 2)
				.scale(1, 0.55, 1)
				.translate(-0.22, 0.97, 0),
			B.bike,
			S.shorts,
		),
	); // saddle
	for (const bone of [B.frontWheel, B.rearWheel]) {
		p.push(
			part(
				new THREE.TorusGeometry(0.312, 0.03, q.tor[0], q.tor[1]),
				bone,
				S.tyre,
			),
		);
		p.push(
			part(
				new THREE.CylinderGeometry(
					0.284,
					0.284,
					0.034,
					q.tor[1],
					1,
					true,
				).rotateX(Math.PI / 2),
				bone,
				S.rim,
			),
		);
		p.push(
			part(
				new THREE.CylinderGeometry(0.25, 0.25, 0.014, q.tor[1]).rotateX(
					Math.PI / 2,
				),
				bone,
				S.rim,
			),
		);
		p.push(
			part(
				new THREE.CylinderGeometry(0.04, 0.04, 0.1, q.tube).rotateX(
					Math.PI / 2,
				),
				bone,
				S.metal,
			),
		);
		// rim decal: rotation is readable at low speed
		p.push(
			part(
				new THREE.BoxGeometry(0.2, 0.03, 0.03).translate(0.14, 0, 0),
				bone,
				S.jerseyAccent,
			),
		);
	}
	p.push(
		part(
			new THREE.CylinderGeometry(0.105, 0.105, 0.014, q.lathe * 2)
				.rotateX(Math.PI / 2)
				.translate(0, 0, 0.06),
			B.crank,
			S.metal,
		),
	);
	p.push(
		part(
			// The right arm lies along +X, so the crank bone's Rz(−a) carries it to
			// the pedal rider-pose.ts puts the right foot on.
			new THREE.BoxGeometry(0.18, 0.03, 0.02).translate(0.086, 0, 0.1),
			B.crank,
			S.metal,
		),
	);
	p.push(
		part(
			new THREE.BoxGeometry(0.18, 0.03, 0.02).translate(-0.086, 0, -0.1),
			B.crank,
			S.metal,
		),
	);
	return p;
}
