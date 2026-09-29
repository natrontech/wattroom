// The rider's vocabulary: its bones, its colour slots, its real lengths,
// and how a primitive becomes a part — rigidly skinned to one bone, tagged
// with the slot its colour comes from.
import * as THREE from 'three';

export const BONES = [
	'root',
	'bike',
	'frontWheel',
	'rearWheel',
	'crank',
	'pelvis',
	'torso',
	'head',
	'thighL',
	'shinL',
	'footL',
	'thighR',
	'shinR',
	'footR',
	'armL',
	'foreL',
	'armR',
	'foreR',
] as const;
export type BoneName = (typeof BONES)[number];
export const B = Object.fromEntries(BONES.map((n, i) => [n, i])) as Record<
	BoneName,
	number
>;

export const SLOTS = [
	'jersey',
	'jerseyAccent',
	'helmet',
	'skin',
	'shorts',
	'shoe',
	'frame',
	'tyre',
	'rim',
	'metal',
	'glasses',
] as const;
export type Slot = (typeof SLOTS)[number];
export const S = Object.fromEntries(SLOTS.map((n, i) => [n, i])) as Record<
	Slot,
	number
>;

export type V3 = readonly [number, number, number];

// Geometry constants (metres). Real lengths where the IK needs them, exaggerated thickness elsewhere.
export const GEO = {
	bb: [0, 0.27],
	crank: 0.1725,
	thigh: 0.45,
	shin: 0.45,
	hip: [-0.19, 1.015],
	ankleOff: [-0.06, 0.07],
	wheelR: 0.34,
	rear: [-0.41, 0.34],
	front: [0.59, 0.34],
	hoods: [0.58, 0.9, 0.2],
	upperArm: 0.29,
	foreArm: 0.29,
} as const;

export function part(geo: THREE.BufferGeometry, bone: number, slot: number) {
	const n = geo.attributes.position.count;
	const si = new Uint16Array(n * 4);
	const sw = new Float32Array(n * 4);
	for (let i = 0; i < n; i++) {
		si[i * 4] = bone;
		sw[i * 4] = 1;
	}
	geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
	geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
	geo.setAttribute(
		'slot',
		new THREE.Float32BufferAttribute(new Float32Array(n).fill(slot), 1),
	);
	geo.deleteAttribute('uv');
	return geo;
}

export const capsule = (r: number, len: number, cap: number, radial: number) =>
	new THREE.CapsuleGeometry(r, len, cap, radial);

// Polygon budget: segments per round part, sized for a rider up close.
export const DETAIL = {
	r: 8,
	cap: 3,
	lathe: 12,
	tor: [6, 24],
	tube: 6,
	tseg: 4,
} as const;
export type Detail = typeof DETAIL;
