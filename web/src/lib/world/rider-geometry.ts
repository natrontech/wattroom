// The clay-toy cyclist's body on its bike: parts built from primitives in
// bone-local space, merged into ONE indexed geometry with a rigid skin, so a
// rider is one SkinnedMesh and one draw call. Which colour goes where is a
// per-vertex slot; rider-model.ts paints them.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bikeParts } from './bike-geometry';
import { B, capsule, DETAIL, GEO, part, S, type Detail } from './rider-rig';

const V2 = (x: number, y: number) => new THREE.Vector2(x, y);
const bean = (
	h: number,
	rTop: number,
	rMid: number,
	rBot: number,
	seg: number,
) =>
	new THREE.LatheGeometry(
		[
			V2(0, 0),
			V2(rBot * 0.7, 0.005),
			V2(rBot, 0.03),
			V2(rMid, h * 0.45),
			V2(rTop, h * 0.85),
			V2(rTop * 0.6, h * 0.97),
			V2(0, h),
		],
		seg,
	);
function bodyParts(q: Detail): THREE.BufferGeometry[] {
	const p: THREE.BufferGeometry[] = [];
	p.push(
		part(
			bean(0.24, 0.14, 0.17, 0.13, q.lathe)
				.scale(1.15, 1, 1.05)
				.translate(0, -0.12, 0),
			B.pelvis,
			S.shorts,
		),
	);
	p.push(
		part(
			bean(0.58, 0.2, 0.18, 0.15, q.lathe).scale(0.8, 1, 1.05),
			B.torso,
			S.jersey,
		),
	);
	// shoulder yoke: the V from behind
	p.push(
		part(
			capsule(0.1, 0.34, q.cap, q.r)
				.rotateX(Math.PI / 2)
				.translate(0, 0.48, 0),
			B.torso,
			S.jerseyAccent,
		),
	);
	p.push(
		part(capsule(0.05, 0.08, q.cap, q.r).translate(0, 0.6, 0), B.torso, S.skin),
	); // neck
	p.push(
		part(new THREE.SphereGeometry(0.125, q.r + 4, q.r + 2), B.head, S.skin),
	);
	p.push(
		part(
			new THREE.SphereGeometry(
				0.16,
				q.r + 6,
				q.r,
				0,
				Math.PI * 2,
				0,
				Math.PI * 0.55,
			)
				.scale(1.3, 0.9, 1.05)
				.translate(-0.02, 0.02, 0),
			B.head,
			S.helmet,
		),
	);
	p.push(
		part(
			capsule(0.035, 0.17, q.cap, q.tube)
				.rotateX(Math.PI / 2)
				.translate(0.1, -0.005, 0),
			B.head,
			S.glasses,
		),
	);
	const legs = [
		[B.thighL, B.shinL, B.footL],
		[B.thighR, B.shinR, B.footR],
	] as const;
	for (const [th, sh, ft] of legs) {
		p.push(
			part(
				capsule(0.085, GEO.thigh, q.cap, q.r).translate(0, -GEO.thigh / 2, 0),
				th,
				S.shorts,
			),
		);
		p.push(
			part(
				capsule(0.062, GEO.shin - 0.02, q.cap, q.r).translate(
					0,
					-GEO.shin / 2,
					0,
				),
				sh,
				S.skin,
			),
		);
		p.push(
			part(
				capsule(0.052, 0.17, q.cap, q.r)
					.rotateZ(Math.PI / 2)
					.scale(1, 0.75, 0.9)
					.translate(0.07, -0.03, 0),
				ft,
				S.shoe,
			),
		);
	}
	const arms = [
		[B.armL, B.foreL],
		[B.armR, B.foreR],
	] as const;
	for (const [a, f] of arms) {
		p.push(
			part(
				capsule(0.055, GEO.upperArm, q.cap, q.r).translate(
					0,
					-GEO.upperArm / 2,
					0,
				),
				a,
				S.jersey,
			),
		);
		p.push(
			part(
				capsule(0.043, GEO.foreArm, q.cap, q.r).translate(
					0,
					-GEO.foreArm / 2,
					0,
				),
				f,
				S.skin,
			),
		);
	}
	return p;
}

export function buildGeometry(): THREE.BufferGeometry {
	const p = [...bikeParts(DETAIL), ...bodyParts(DETAIL)];
	const merged = mergeGeometries(p, false);
	p.forEach((g) => g.dispose());
	if (!merged) throw new Error('rider-geometry: parts do not share attributes');
	return merged;
}
