import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Route } from '$lib/road/route';
import type { PropColors } from '../styles';
import { batchProps, FAR_M, NEAR_M, TILE_M } from './batch';
import type { Prop } from './scatter';

const route = { minEle: 0 } as Route;
const colors = new Proxy({}, { get: () => 'white' }) as PropColors;
const mat = () => new THREE.MeshBasicMaterial();
const materials = { trees: mat(), buildings: mat(), stock: mat() };

// A tile's own centre, so distances to it read straight.
const at = (kind: Prop['kind'], x: number): Prop => ({
	kind,
	x: x + TILE_M / 2,
	z: -TILE_M / 2,
	base: 0,
	rot: 0,
	scale: 1,
});

describe('the props as the GPU draws them (#3076)', () => {
	it('is one batch per material family, every instance culled on its own', () => {
		const b = batchProps(
			route,
			[
				at('spruce', 0),
				at('broadleaf', 0),
				at('house', 0),
				at('cow', 0),
				at('rock', 0),
			],
			colors,
			materials,
		);
		expect(b.meshes).toHaveLength(3);
		expect(b.meshes.map((m) => m.instanceCount).sort()).toEqual([1, 2, 2]);
		expect(b.meshes.every((m) => m.perObjectFrustumCulled)).toBe(true);
	});

	it('swaps a tile between rings at their edges, and back only 10 % past them', () => {
		const b = batchProps(route, [at('spruce', 0)], colors, materials);
		const [mesh] = b.meshes;
		const near = mesh.getGeometryIdAt(0);
		const eye = new THREE.Vector3();
		const seen = (x: number) => {
			b.update(eye.set(x, 0, -TILE_M / 2));
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

	it('draws a far model for a fraction of the near one', () => {
		const b = batchProps(route, [at('spruce', 0)], colors, materials);
		const [mesh] = b.meshes;
		const tris = () =>
			mesh.getGeometryRangeAt(mesh.getGeometryIdAt(0))!.count / 3;
		const near = tris();
		b.update(new THREE.Vector3(TILE_M / 2 + NEAR_M * 1.5, 0, -TILE_M / 2));
		expect(tris()).toBeLessThan(near / 2);
	});
});
