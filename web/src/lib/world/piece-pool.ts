import * as THREE from 'three';

/**
 * Streamed pieces of one material in one BatchedMesh (#3606): a draw call
 * where WEBGL_multi_draw is, each piece culled on its own, added and dropped
 * by key as the rider rides. A dropped piece's slot waits for the next piece
 * of its size — a ground chunk is one of two — so the buffers never fragment;
 * the batch grows by half when it runs out.
 */
export function piecePool(
	material: THREE.Material,
	room: { pieces: number; vertices: number; indices: number },
) {
	const mesh = new THREE.BatchedMesh(
		room.pieces,
		room.vertices,
		room.indices,
		material,
	);
	mesh.frustumCulled = false; // its pieces are culled one by one
	mesh.perObjectFrustumCulled = true;
	mesh.sortObjects = false;

	type Slot = { geometry: number; instance: number; size: string };
	const live = new Map<string, Slot>();
	const free = new Map<string, Slot[]>();

	function drop(key: string) {
		const slot = live.get(key);
		if (!slot) return;
		live.delete(key);
		mesh.setVisibleAt(slot.instance, false);
		const list = free.get(slot.size) ?? [];
		list.push(slot);
		free.set(slot.size, list);
	}

	let { vertices: maxV, indices: maxI } = room;
	function fit(vertices: number, indices: number) {
		if (mesh.unusedVertexCount < vertices || mesh.unusedIndexCount < indices) {
			maxV = Math.max(Math.ceil(maxV * 1.5), maxV + vertices);
			maxI = Math.max(Math.ceil(maxI * 1.5), maxI + indices);
			mesh.setGeometrySize(maxV, maxI);
		}
		if (mesh.instanceCount >= mesh.maxInstanceCount)
			mesh.setInstanceCount(Math.ceil(mesh.maxInstanceCount * 1.5));
	}

	return {
		mesh,
		/** Pieces drawn now. */
		get size() {
			return live.size;
		},
		has: (key: string) => live.has(key),
		/** Draws `g` as `key`, in place of what `key` drew before; the pool copies it and disposes it. */
		add(key: string, g: THREE.BufferGeometry) {
			drop(key);
			const vertices = g.attributes.position.count;
			const indices = g.index?.count ?? 0;
			const size = `${vertices}:${indices}`;
			const slot = free.get(size)?.pop();
			if (slot) {
				mesh.setGeometryAt(slot.geometry, g);
				mesh.setVisibleAt(slot.instance, true);
				live.set(key, slot);
			} else {
				fit(vertices, indices);
				const geometry = mesh.addGeometry(g);
				live.set(key, { geometry, instance: mesh.addInstance(geometry), size });
			}
			g.dispose();
		},
		drop,
	};
}

export type PiecePool = ReturnType<typeof piecePool>;
