import * as THREE from 'three';
import type { Route } from '$lib/road/route';
import { yOf } from '../geometry';
import * as P from '../props';
import type { PropColors } from '../styles';
import type { Origin } from '../terrain/ground';
import type { PropKind } from './kit';
import type { Prop } from './scatter';

/**
 * The props as the GPU draws them (#3076): one BatchedMesh per material
 * family — a draw call each where WEBGL_multi_draw is, about all of
 * Chromium and Safari — every instance culled on its own. Instances sit in
 * 250 m tiles aligned to the world; a tile draws its near models inside the
 * near ring, its far stand-ins in the far ring and nothing past it, swapped
 * as the rider rides.
 */

export type Family = 'trees' | 'buildings' | 'stock';
export const FAMILY: Record<PropKind, Family> = {
	spruce: 'trees',
	broadleaf: 'trees',
	house: 'buildings',
	church: 'buildings',
	barn: 'buildings',
	hut: 'buildings',
	cow: 'stock',
	rock: 'stock',
};

type Models = (c: PropColors) => THREE.BufferGeometry;
const MODELS: Record<PropKind, [near: Models, far: Models]> = {
	spruce: [P.spruce, P.spruceFar],
	broadleaf: [P.broadleaf, P.broadleafFar],
	house: [P.house, P.houseFar],
	church: [P.church, P.churchFar],
	barn: [P.barn, P.barnFar],
	hut: [P.hut, P.hutFar],
	cow: [P.cow, P.cowFar],
	rock: [P.rock, P.rock], // 36 triangles is its own stand-in
};

export const TILE_M = 250;
/**
 * Tiles nearer the eye than this draw near models; a far tile comes back in
 * only once it is inside, and goes out only past 10 % more — #3220's
 * hysteresis, so a tile on the edge never flickers.
 */
export const NEAR_M = 600;
/** Past this nothing is drawn: the objects' coverage (docs/SPEC.md proposals, #3082 measures them). */
export const FAR_M = 2500;
const LEAVE = 1.1;

type Ring = 0 | 1 | 2; // near, far, past both

export function batchProps(
	route: Route,
	props: readonly Prop[],
	colors: PropColors,
	materials: Record<Family, THREE.Material>,
	origin: Origin = [0, 0],
) {
	const [e0, n0] = origin;
	const meshes = new Map<Family, THREE.BatchedMesh>();
	const geometry = new Map<PropKind, [number, number]>();
	const families = [...new Set(props.map((p) => FAMILY[p.kind]))];
	for (const family of families) {
		const kinds = (Object.keys(FAMILY) as PropKind[]).filter(
			(k) => FAMILY[k] === family,
		);
		const models = kinds.map(
			(k) =>
				MODELS[k].map((m) => m(colors)) as [
					THREE.BufferGeometry,
					THREE.BufferGeometry,
				],
		);
		const vertices = models
			.flat()
			.reduce((n, g) => n + g.attributes.position.count, 0);
		const count = props.filter((p) => FAMILY[p.kind] === family).length;
		const mesh = new THREE.BatchedMesh(count, vertices, 0, materials[family]);
		mesh.perObjectFrustumCulled = true;
		mesh.sortObjects = false;
		kinds.forEach((k, i) => {
			geometry.set(k, [
				mesh.addGeometry(models[i][0]),
				mesh.addGeometry(models[i][1]),
			]);
			models[i].forEach((g) => g.dispose());
		});
		meshes.set(family, mesh);
	}

	type Tile = {
		cx: number;
		cz: number;
		ring: Ring;
		members: [THREE.BatchedMesh, number, PropKind][];
	};
	const tiles = new Map<string, Tile>();
	const m = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const up = new THREE.Vector3(0, 1, 0);
	const at = new THREE.Vector3();
	const size = new THREE.Vector3();
	for (const p of props) {
		const mesh = meshes.get(FAMILY[p.kind])!;
		const id = mesh.addInstance(geometry.get(p.kind)![0]);
		q.setFromAxisAngle(up, Math.atan2(p.turn[1], p.turn[0]));
		mesh.setMatrixAt(
			id,
			m.compose(
				at.set(p.x, yOf(route, p.base), p.z),
				q,
				size.setScalar(p.scale),
			),
		);
		const ti = Math.floor((e0 + p.x) / TILE_M);
		const tj = Math.floor((n0 - p.z) / TILE_M);
		const key = `${ti}:${tj}`;
		let tile = tiles.get(key);
		if (!tile) {
			tile = {
				cx: (ti + 0.5) * TILE_M - e0,
				cz: n0 - (tj + 0.5) * TILE_M,
				ring: 0,
				members: [],
			};
			tiles.set(key, tile);
		}
		tile.members.push([mesh, id, p.kind]);
	}
	for (const mesh of meshes.values()) mesh.computeBoundingSphere();

	return {
		meshes: [...meshes.values()],
		/** Swaps each tile to the ring the eye now puts it in. */
		update(eye: THREE.Vector3) {
			for (const tile of tiles.values()) {
				const d = Math.hypot(tile.cx - eye.x, tile.cz - eye.z);
				// A tile crosses an edge inward at the edge, outward only 10 % past it.
				const inside = (r: number, was: boolean) =>
					was ? d <= r * LEAVE : d < r;
				const ring: Ring = inside(NEAR_M, tile.ring === 0)
					? 0
					: inside(FAR_M, tile.ring <= 1)
						? 1
						: 2;
				if (ring === tile.ring) continue;
				tile.ring = ring;
				for (const [mesh, id, kind] of tile.members) {
					mesh.setVisibleAt(id, ring < 2);
					if (ring !== 2) mesh.setGeometryIdAt(id, geometry.get(kind)![ring]);
				}
			}
		},
	};
}
