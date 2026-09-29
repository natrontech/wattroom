// A rider as the scene holds it: the body painted in one hue (identity,
// never live data), a toon material with a rim light, and the bones the
// pose solver moves. Pose is computed on the CPU from crank angle, wheel
// angle and posture; nothing is keyframed (rider-pose.ts).
import * as THREE from 'three';
import { BONES, SLOTS, type BoneName, type Slot } from './rider-rig';
import type { RiderKit } from './styles';

export type RiderPalette = Record<Slot, THREE.Color>;

// One hue in, a palette out: identity only. Zone (live data) never goes on the body.
export function paletteFor(hue: number, kit: RiderKit): RiderPalette {
	const c = (h: number, s: number, l: number) =>
		new THREE.Color().setHSL((((h % 360) + 360) % 360) / 360, s, l);
	return {
		jersey: c(hue, 0.62, 0.56),
		jerseyAccent: c(hue, 0.5, 0.34),
		helmet: c(hue + 150, 0.7, 0.62),
		skin: c(28, 0.5, 0.62),
		shorts: c(hue, 0.35, 0.2),
		shoe: new THREE.Color(kit.shoe),
		frame: c(hue + 40, 0.3, 0.3),
		tyre: new THREE.Color(kit.tyre),
		rim: new THREE.Color(kit.rim),
		metal: new THREE.Color(kit.metal),
		glasses: new THREE.Color(kit.glasses),
	};
}

export function paint(
	geo: THREE.BufferGeometry,
	pal: RiderPalette,
): THREE.BufferGeometry {
	const slot = geo.attributes.slot.array;
	const col = new Float32Array(slot.length * 3);
	const list = SLOTS.map((s) => pal[s]);
	for (let i = 0; i < slot.length; i++) {
		const c = list[slot[i]];
		col[i * 3] = c.r;
		col[i * 3 + 1] = c.g;
		col[i * 3 + 2] = c.b;
	}
	geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
	return geo;
}

// Three bands, TF2-style: the shadow band is lifted (never black); nearest filter = hard terminator.
export const RIDER_RAMP = [110 / 255, 185 / 255, 1] as const;

// Toon ramp + a fresnel rim in the style's sky colour: separates a dark kit
// from a dark road (TF2's rim instead of outlines).
export function riderMaterial(
	gradientMap: THREE.Texture,
	rim: THREE.Color,
): THREE.MeshToonMaterial {
	const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
	m.onBeforeCompile = (sh) => {
		sh.uniforms.uRim = { value: rim };
		sh.fragmentShader =
			'uniform vec3 uRim;\n' +
			sh.fragmentShader.replace(
				'#include <opaque_fragment>',
				'float rimF = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);\noutgoingLight += uRim * rimF;\n#include <opaque_fragment>',
			);
	};
	return m;
}

export type RiderModel = {
	mesh: THREE.SkinnedMesh;
	bones: Record<BoneName, THREE.Bone>;
};

export function makeRider(
	geometry: THREE.BufferGeometry,
	material: THREE.Material,
): RiderModel {
	const mesh = new THREE.SkinnedMesh(geometry, material);
	const list = BONES.map((name) => Object.assign(new THREE.Bone(), { name }));
	list.forEach((b) => mesh.add(b)); // flat rig: every bone's local transform is set directly from the pose solver
	mesh.bind(
		new THREE.Skeleton(
			list,
			list.map(() => new THREE.Matrix4()),
		),
		new THREE.Matrix4(),
	);
	mesh.frustumCulled = false; // skinned bounds do not follow the pose; a rider is small and near the camera
	const bones = Object.fromEntries(BONES.map((n, i) => [n, list[i]])) as Record<
		BoneName,
		THREE.Bone
	>;
	return { mesh, bones };
}
