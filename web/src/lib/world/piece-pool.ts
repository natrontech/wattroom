import * as THREE from 'three';

/**
 * Streamed pieces of one material in one BatchedMesh (#3606): a draw call
 * where WEBGL_multi_draw is, each piece culled on its own, added and dropped
 * by key as the rider rides. A dropped piece's slot waits for the next piece
 * of its size — a ground chunk is one of two — so the buffers never fragment;
 * the batch grows by half when it runs out.
 *
 * With `cellM`, the pieces are culled by the cell of that many metres they
 * lie in instead (#4566): the ground is 12,700 pieces, and three culls a
 * batch's pieces one by one on every frame, a matrix read and a sphere
 * each, which was two thirds of the world's script time. A cell's box is
 * tested once a frame and its pieces are shown or hidden only when the
 * answer changes; three then walks the batch only on those frames.
 */
export function piecePool(
	material: THREE.Material,
	room: { pieces: number; vertices: number; indices: number },
	cellM = 0,
) {
	const mesh = new THREE.BatchedMesh(
		room.pieces,
		room.vertices,
		room.indices,
		material,
	);
	mesh.frustumCulled = false; // its pieces are culled one by one
	mesh.perObjectFrustumCulled = cellM === 0;
	mesh.sortObjects = false;

	type Cell = { box: THREE.Box3; seen: boolean; slots: Set<Slot> };
	type Slot = { geometry: number; instance: number; size: string; cell?: Cell };
	const live = new Map<string, Slot>();
	const free = new Map<string, Slot[]>();
	const cells = new Map<string, Cell>();
	const box = new THREE.Box3();
	const centre = new THREE.Vector3();

	/** Puts a piece of bounds `box` in its cell, shown as the cell is. */
	function place(slot: Slot) {
		box.getCenter(centre);
		const key = `${Math.floor(centre.x / cellM)},${Math.floor(centre.z / cellM)}`;
		let cell = cells.get(key);
		if (!cell)
			cells.set(
				key,
				(cell = { box: box.clone(), seen: true, slots: new Set() }),
			);
		else cell.box.union(box);
		cell.slots.add(slot);
		slot.cell = cell;
		mesh.setVisibleAt(slot.instance, cell.seen);
	}
	const frustum = new THREE.Frustum();
	const view = new THREE.Matrix4();
	/** Shows the cells `camera` sees and hides the rest. */
	function cull(camera: THREE.Camera) {
		view
			.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
			.multiply(mesh.matrixWorld);
		frustum.setFromProjectionMatrix(
			view,
			camera.coordinateSystem,
			camera.reversedDepth,
		);
		cullTo(frustum);
	}
	function cullTo(f: THREE.Frustum) {
		for (const cell of cells.values()) {
			const seen = f.intersectsBox(cell.box);
			if (seen === cell.seen) continue;
			cell.seen = seen;
			for (const slot of cell.slots) mesh.setVisibleAt(slot.instance, seen);
		}
	}
	if (cellM > 0) {
		// Whatever camera draws it culls it first: the ride's, a photo's, the orbit's.
		const draw = mesh.onBeforeRender;
		mesh.onBeforeRender = function (renderer, scene, camera, ...rest) {
			cull(camera);
			draw.call(this, renderer, scene, camera, ...rest);
		};
		// The scene budget's test counts what a frustum sees without a renderer.
		mesh.userData.cull = cullTo;
	}

	function drop(key: string) {
		const slot = live.get(key);
		if (!slot) return;
		live.delete(key);
		if (slot.cell) {
			slot.cell.slots.delete(slot);
			// An empty cell goes, and its box with it: a cell's box only ever grows.
			if (slot.cell.slots.size === 0)
				for (const [k, c] of cells) if (c === slot.cell) cells.delete(k);
			slot.cell = undefined;
		}
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
			let slot = free.get(size)?.pop();
			if (slot) {
				mesh.setGeometryAt(slot.geometry, g);
				mesh.setVisibleAt(slot.instance, true);
			} else {
				fit(vertices, indices);
				const geometry = mesh.addGeometry(g);
				slot = { geometry, instance: mesh.addInstance(geometry), size };
			}
			live.set(key, slot);
			if (cellM > 0) {
				if (!g.boundingBox) g.computeBoundingBox();
				box.copy(g.boundingBox!);
				place(slot);
			}
			g.dispose();
		},
		drop,
	};
}
