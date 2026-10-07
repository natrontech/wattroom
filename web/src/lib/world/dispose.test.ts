import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { disposeTree } from './dispose';

describe('disposeTree', () => {
	it('frees a texture a shader holds in a uniform, as the sky holds its skyline', () => {
		const skyline = new THREE.DataTexture(new Uint8Array(4), 4, 1);
		let freed = false;
		skyline.addEventListener('dispose', () => (freed = true));
		const root = new THREE.Group();
		root.add(
			new THREE.Mesh(
				new THREE.BufferGeometry(),
				new THREE.ShaderMaterial({
					uniforms: { uSkyline: { value: skyline } },
				}),
			),
		);
		disposeTree(root);
		expect(freed).toBe(true);
	});
});
