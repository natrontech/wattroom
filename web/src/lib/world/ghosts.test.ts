// @vitest-environment happy-dom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { at, leftOf } from '$lib/road/along';
import { toRoute } from '$lib/road/route';
import { DEFAULT_DARK_ID, themeById } from '$lib/themes';
import { KEEP_RIGHT, makeCrew } from './crew';
import { GHOST_OPACITY, GHOST_PALE, makeGhosts, MOST_GHOSTS } from './ghosts';
import { seededLoadout } from './loadout';
import { RIDE } from './look.test-helper';
import { simRider } from './sim';
import { syntheticPoints } from './synthetic';

const route = toRoute(syntheticPoints());
const you = seededLoadout('you');

/** Everything the ghosts' group would draw. */
function drawn(group: THREE.Object3D): THREE.Mesh[] {
	const out: THREE.Mesh[] = [];
	group.traverse((o) => {
		if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
	});
	return out;
}

describe('your ghosts on the road (#3245, ADR-0068)', () => {
	it('draws up to three as one skinned figure, instanced: one draw', () => {
		const ghosts = makeGhosts(RIDE, you, 250);
		const ahead = [100, 140, 180, 220].map((d) => ({ d, v: 8 }));
		ghosts.update(route, ahead, 1 / 30, false);
		const meshes = drawn(ghosts.group);
		expect(meshes).toHaveLength(1);
		const [ghost] = meshes as (THREE.SkinnedMesh & THREE.InstancedMesh)[];
		expect(ghost.isSkinnedMesh).toBe(true);
		expect(ghost.isInstancedMesh).toBe(true);
		expect(ghost.count).toBe(MOST_GHOSTS);
		expect(ghosts.shown).toBe(3);
		expect(ghost.userData).toMatchObject({ family: 'figures', kind: 'ghost' });
	});

	it('is your figure in your own kit, see-through, with no ring, shadow, tag, trail or glow', () => {
		const ghosts = makeGhosts(RIDE, you, 250);
		const [ghost] = drawn(ghosts.group) as THREE.SkinnedMesh[];
		const m = ghost.material as THREE.MeshToonMaterial;
		expect(m.transparent).toBe(true);
		expect(m.opacity).toBe(GHOST_OPACITY);
		// Blended, never dithered like a rider arriving (#3098).
		expect(m.alphaHash).toBe(false);
		expect(m.blending).toBe(THREE.NormalBlending);
		expect(m.depthWrite).toBe(false);
		expect(m.emissive.getHex()).toBe(0);
		// Never the watt or the neon token (ADR-0005), and only the default layer: no bloom.
		const tokens = themeById(DEFAULT_DARK_ID)!.tokens;
		for (const token of [tokens.watt, tokens.neon])
			expect(m.color.getHex()).not.toBe(new THREE.Color(token).getHex());
		expect(ghost.layers.mask).toBe(1);
		// The kit your own figure wears, paled toward white, slot for slot: lighter than anyone live.
		const crew = makeCrew(RIDE, new THREE.Color());
		const r = simRider({
			id: 'you',
			name: 'You',
			mass: 75,
			ftp: 250,
			you: true,
			watts: 200,
			d: 100,
		});
		crew.update(route, [r], () => ({ crank: 0 }), 0, 0, false);
		const yours = crew.you!.geometry.getAttribute('color').array;
		const its = ghost.geometry.getAttribute('color').array;
		expect(its).toHaveLength(yours.length);
		for (let i = 0; i < yours.length; i++)
			expect(its[i]).toBeCloseTo(yours[i] + (1 - yours[i]) * GHOST_PALE, 5);
	});

	it('rides beside you, a lane to your left, and none on the orbit view', () => {
		const ghosts = makeGhosts(RIDE, you, 250);
		ghosts.update(route, [{ d: 500, v: 8 }], 1 / 30, false);
		const [ghost] = drawn(ghosts.group) as THREE.InstancedMesh[];
		const placed = new THREE.Matrix4().fromArray(ghost.instanceMatrix.array);
		const p = new THREE.Vector3().setFromMatrixPosition(placed);
		const road = at(route, 500);
		const { lx, lz } = leftOf(road.heading);
		const lane = (p.x - road.x) * lx + (p.z - road.z) * lz;
		expect(lane).toBeGreaterThan(KEEP_RIGHT);
		ghosts.update(route, [{ d: 500, v: 8 }], 1 / 30, true);
		expect(ghosts.shown).toBe(0);
		ghosts.update(route, [], 1 / 30, false);
		expect(ghosts.shown).toBe(0);
	});
});
