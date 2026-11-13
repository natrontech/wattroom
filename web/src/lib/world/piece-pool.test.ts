import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { piecePool } from './piece-pool';

const room = { pieces: 8, vertices: 400, indices: 600 };
/** A 10 m square of ground centred on (x, z). */
function piece(x: number, z: number) {
	const g = new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2);
	return g.translate(x, 0, z);
}
/** What a camera at the origin sees looking down −z, 500 m out. */
function looking() {
	const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
	camera.updateMatrixWorld();
	return new THREE.Frustum().setFromProjectionMatrix(
		new THREE.Matrix4().multiplyMatrices(
			camera.projectionMatrix,
			camera.matrixWorldInverse,
		),
	);
}
const shown = (mesh: THREE.BatchedMesh) => {
	let n = 0;
	for (let i = 0; i < mesh.instanceCount; i++) if (mesh.getVisibleAt(i)) n++;
	return n;
};

describe('a pool culled by cells (#4566)', () => {
	it('leaves three no piece to cull one by one', () => {
		expect(
			piecePool(new THREE.MeshBasicMaterial(), room, 100).mesh
				.perObjectFrustumCulled,
		).toBe(false);
		expect(
			piecePool(new THREE.MeshBasicMaterial(), room).mesh
				.perObjectFrustumCulled,
		).toBe(true);
	});

	it('shows the cells in view and hides the ones behind the eye', () => {
		const pool = piecePool(new THREE.MeshBasicMaterial(), room, 100);
		const cull = pool.mesh.userData.cull as (f: THREE.Frustum) => void;
		pool.add('ahead', piece(0, -150));
		pool.add('beside it', piece(20, -160));
		pool.add('behind', piece(0, 250));
		cull(looking());
		expect(shown(pool.mesh)).toBe(2);
	});

	it('shows a piece that arrives in a hidden cell as hidden, and in a seen one as seen', () => {
		const pool = piecePool(new THREE.MeshBasicMaterial(), room, 100);
		const cull = pool.mesh.userData.cull as (f: THREE.Frustum) => void;
		pool.add('ahead', piece(0, -150));
		pool.add('behind', piece(0, 250));
		cull(looking());
		pool.add('behind too', piece(10, 260));
		pool.add('ahead too', piece(10, -160));
		expect(shown(pool.mesh)).toBe(2);
	});

	it('forgets a cell with its last piece: the next piece there is seen until a frame says otherwise', () => {
		const pool = piecePool(new THREE.MeshBasicMaterial(), room, 100);
		const cull = pool.mesh.userData.cull as (f: THREE.Frustum) => void;
		pool.add('behind', piece(0, 250));
		cull(looking());
		expect(shown(pool.mesh)).toBe(0);
		pool.drop('behind');
		pool.add('behind again', piece(0, 250));
		expect(shown(pool.mesh)).toBe(1);
		cull(looking());
		expect(shown(pool.mesh)).toBe(0);
	});
});
