import * as THREE from 'three';

// Free everything a subtree holds on the GPU: geometries, materials, the
// textures those materials reference, instance buffers and bone textures.
// Shared resources are released once each; three ignores a second dispose.
export function disposeTree(root: THREE.Object3D): void {
	const textures = new Set<THREE.Texture>();
	const materials = new Set<THREE.Material>();
	root.traverse((o) => {
		if (o instanceof THREE.InstancedMesh) o.dispose();
		if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose();
		if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
			o.geometry.dispose();
			const list: THREE.Material[] = Array.isArray(o.material)
				? o.material
				: [o.material];
			list.forEach((m) => materials.add(m));
		}
	});
	for (const m of materials) {
		for (const value of Object.values(m))
			if (value instanceof THREE.Texture) textures.add(value);
		m.dispose();
	}
	textures.forEach((t) => t.dispose());
}
