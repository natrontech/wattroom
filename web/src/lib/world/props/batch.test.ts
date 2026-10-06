import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Route } from '$lib/road/route';
import type { PropColors } from '../styles';
import { batchProps, FAR_M, NEAR_M, type Drawn } from './batch';
import { TILE_M } from './tiles';

const route = { minEle: 0 } as Route;
const colors = new Proxy({}, { get: () => 'white' }) as PropColors;
const mat = () => new THREE.MeshBasicMaterial();
const materials = { trees: mat(), buildings: mat(), stock: mat() };

// A tile's own centre, so distances to it read straight.
const centre: [number, number] = [TILE_M / 2, -TILE_M / 2];
const at = (kind: Drawn['kind']): Drawn => ({
	kind,
	x: centre[0],
	z: centre[1],
	base: 0,
	turn: [1, 0],
	scale: 1,
});
const eye = (x = centre[0]) => new THREE.Vector3(x, 0, centre[1]);

describe('the dressing as the GPU draws it (#3076, #3699)', () => {
	it('is one batch per material family, props and set pieces alike, every instance culled on its own', () => {
		const b = batchProps(route, colors, materials);
		b.add(
			'0:-1',
			centre,
			(
				[
					'spruce',
					'linden',
					'house',
					'chapel',
					'cow',
					'rock',
					'bench',
					'flag2',
				] as const
			).map(at),
			eye(),
		);
		expect(b.meshes).toHaveLength(3);
		expect(b.meshes.map((m) => m.instanceCount).sort()).toEqual([2, 2, 4]);
		expect(b.meshes.every((m) => m.perObjectFrustumCulled)).toBe(true);
	});

	it('frees a tile’s instances when it is let go, and takes them back for the next', () => {
		const b = batchProps(route, colors, materials);
		const trees = b.meshes[0];
		b.add('a', centre, [at('spruce'), at('spruce')], eye());
		b.drop('a');
		expect(trees.instanceCount).toBe(0);
		expect(b.has('a')).toBe(false);
		b.add('b', centre, [at('spruce')], eye());
		expect(trees.instanceCount).toBe(1);
	});

	it('makes room past its first, however many a tile brings', () => {
		const b = batchProps(route, colors, materials);
		const many = Array.from({ length: 5000 }, () => at('spruce'));
		b.add('a', centre, many, eye());
		expect(b.meshes[0].instanceCount).toBe(5000);
	});

	it('swaps a tile between rings at their edges, and back only 10 % past them', () => {
		const b = batchProps(route, colors, materials);
		b.add('a', centre, [at('spruce')], eye());
		const [mesh] = b.meshes;
		const near = mesh.getGeometryIdAt(0);
		const seen = (x: number) => {
			b.update(eye(x));
			return mesh.getVisibleAt(0)
				? mesh.getGeometryIdAt(0) === near
					? 'near'
					: 'far'
				: 'gone';
		};
		// Walking away: each edge let go only 10 % past it.
		expect(seen(TILE_M / 2 + NEAR_M * 1.05)).toBe('near');
		expect(seen(TILE_M / 2 + NEAR_M * 1.15)).toBe('far');
		expect(seen(TILE_M / 2 + FAR_M * 1.05)).toBe('far');
		expect(seen(TILE_M / 2 + FAR_M * 1.15)).toBe('gone');
		// Walking back: each edge taken at the edge itself.
		expect(seen(TILE_M / 2 + FAR_M * 1.02)).toBe('gone');
		expect(seen(TILE_M / 2 + FAR_M * 0.98)).toBe('far');
		expect(seen(TILE_M / 2 + NEAR_M * 1.02)).toBe('far');
		expect(seen(TILE_M / 2 + NEAR_M * 0.98)).toBe('near');
	});

	it('draws a tile added far away at its far ring at once, a fraction of the near', () => {
		const b = batchProps(route, colors, materials);
		b.add('a', centre, [at('spruce')], eye(TILE_M / 2 + NEAR_M * 1.5));
		const [mesh] = b.meshes;
		const tris = () =>
			mesh.getGeometryRangeAt(mesh.getGeometryIdAt(0))!.count / 3;
		const far = tris();
		b.update(eye());
		expect(far).toBeLessThan(tris() / 2);
	});
});
