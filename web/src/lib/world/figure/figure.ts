import * as THREE from 'three';
import type { Build } from './bikes/fit';
import { buildBike } from './bike-mesh';
import { BONES, SLOTS, type SlotName } from './contract';
import { buildHead } from './head';
import type { Kit } from './kit';
import { buildArms, buildLegs } from './limbs';
import { MeshBuilder } from './mesh';
import { restMatrices, rigFor, type Rig } from './rig';
import { buildFeet, buildHands, buildPelvis, buildTorso } from './trunk';
import { buildDrivetrain, buildWheel } from './wheel-mesh';

/**
 * A figure on its bike as ONE SkinnedMesh (#3070, ADR-0073): one draw call per
 * rider, 21 bones, posed on the CPU from data (#3071 writes the pose). Until a
 * pose is written, every bone holds its rest transform and the figure stands
 * in its bind pose.
 */

/** The colour of every slot; the caller's, since lib/world carries no colours. */
export type Palette = Record<SlotName, THREE.Color>;

export type FigureOptions = {
	/** 0 up close; 1 for riders further off. */
	lod?: 0 | 1;
	body?: { height?: number; build?: Build };
	palette?: Palette;
	material?: THREE.Material;
};

export type Figure = THREE.SkinnedMesh & {
	userData: { rig: Rig; kit: Kit; bones: Record<string, THREE.Bone> };
};

/** Every vertex's colour from its slot. */
export function paint(geo: THREE.BufferGeometry, palette: Palette): void {
	const slot = geo.attributes.slot.array;
	const col = new Float32Array(slot.length * 3);
	const list = SLOTS.map((s) => palette[s]);
	for (let i = 0; i < slot.length; i++) {
		const c = list[slot[i]];
		col[i * 3] = c.r;
		col[i * 3 + 1] = c.g;
		col[i * 3 + 2] = c.b;
	}
	geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

export function buildFigure(kit: Kit, o: FigureOptions = {}): Figure {
	const rig = rigFor(kit, o.body);
	const mb = new MeshBuilder(restMatrices(rig.dims), o.lod ?? 0);
	buildLegs(mb, rig.dims, kit);
	buildArms(mb, rig.dims, kit);
	buildTorso(mb, rig.dims);
	buildPelvis(mb, rig.dims);
	buildHead(mb, rig.dims, kit);
	buildHands(mb, rig.dims, kit);
	buildFeet(mb, rig.dims, kit);
	buildBike(mb, rig, kit);
	buildDrivetrain(mb, rig, kit);
	buildWheel(mb, rig, kit, 'front');
	buildWheel(mb, rig, kit, 'rear');
	const geo = mb.build();
	if (o.palette) paint(geo, o.palette);
	const material =
		o.material ?? new THREE.MeshLambertMaterial({ vertexColors: !!o.palette });
	const mesh = new THREE.SkinnedMesh(geo, material) as Figure;
	const bones = BONES.map((name, i) => {
		const bone = Object.assign(new THREE.Bone(), {
			name,
			matrixAutoUpdate: false,
		});
		bone.matrix.copy(mb.rest[i]);
		return bone;
	});
	// A flat rig: every bone's matrix is written whole, by the pose.
	for (const bone of bones) mesh.add(bone);
	mesh.bind(
		new THREE.Skeleton(
			bones,
			mb.rest.map((m) => m.clone().invert()),
		),
		new THREE.Matrix4(),
	);
	// Skinned bounds do not follow the pose; a rider is small and near the camera.
	mesh.frustumCulled = false;
	mesh.userData = {
		rig,
		kit,
		bones: Object.fromEntries(BONES.map((n, i) => [n, bones[i]])),
	};
	return mesh;
}
