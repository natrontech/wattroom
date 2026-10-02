import * as THREE from 'three';
import type { Route } from '$lib/road/route';
import { yOf } from '../geometry';
import * as P from '../props';
import type { PieceKind } from '../setpieces';
import type { PropColors } from '../styles';
import type { PropKind } from './kit';
import type { Turn } from './roads';

/**
 * The dressing as the GPU draws it (#3076, #3699): one BatchedMesh per
 * material family — a draw call each where WEBGL_multi_draw is, about all of
 * Chromium and Safari — every instance culled on its own. Props and set
 * pieces alike come and go a 250 m tile at a time as the rider rides; a tile
 * draws its near models inside the near ring and its far stand-ins in the
 * far ring, and is let go past it.
 */

/** Every model the dressing draws: the props, the set pieces, and each flag's colour as its own. */
export type DrawKind =
	PropKind | Exclude<PieceKind, 'flag'> | `flag${0 | 1 | 2 | 3}`;
export type Family = 'trees' | 'buildings' | 'stock';
export const FAMILY: Record<DrawKind, Family> = {
	spruce: 'trees',
	broadleaf: 'trees',
	linden: 'trees',
	house: 'buildings',
	church: 'buildings',
	barn: 'buildings',
	hut: 'buildings',
	chapel: 'buildings',
	// Low kits never block (≤ 2 m under a 4.4 m eye): no fade.
	cow: 'stock',
	rock: 'stock',
	bench: 'stock',
	woodpile: 'stock',
	bales: 'stock',
	wayside: 'stock',
	signpost: 'stock',
	fountain: 'stock',
	fence: 'stock',
	snowpole: 'stock',
	delineator: 'stock',
	flag0: 'stock',
	flag1: 'stock',
	flag2: 'stock',
	flag3: 'stock',
};

type Models = (c: PropColors) => THREE.BufferGeometry;
const flag =
	(i: number): Models =>
	(c) =>
		P.flagpole(c, c.flags[i]);
// A kit with no stand-in is its own: at a few dozen triangles it is the far model too.
const MODELS: Record<DrawKind, [near: Models, far: Models]> = {
	spruce: [P.spruce, P.spruceFar],
	broadleaf: [P.broadleaf, P.broadleafFar],
	linden: [P.linden, P.linden],
	house: [P.house, P.houseFar],
	church: [P.church, P.churchFar],
	barn: [P.barn, P.barnFar],
	hut: [P.hut, P.hutFar],
	chapel: [P.chapel, P.chapel],
	cow: [P.cow, P.cowFar],
	rock: [P.rock, P.rock],
	bench: [P.bench, P.bench],
	woodpile: [P.woodpile, P.woodpile],
	bales: [P.bales, P.bales],
	wayside: [P.wayside, P.wayside],
	signpost: [P.signpost, P.signpost],
	fountain: [P.fountain, P.fountain],
	fence: [P.fence, P.fence],
	snowpole: [P.snowpole, P.snowpole],
	delineator: [P.delineator, P.delineator],
	flag0: [flag(0), flag(0)],
	flag1: [flag(1), flag(1)],
	flag2: [flag(2), flag(2)],
	flag3: [flag(3), flag(3)],
};

/** One thing to draw: its model, where it stands, how it is turned and sized. */
export type Drawn = {
	kind: DrawKind;
	x: number;
	z: number;
	base: number;
	turn: Turn;
	scale: number;
};

/**
 * Tiles nearer the eye than this draw near models; a far tile comes back in
 * only once it is inside, and goes out only past 10 % more — #3220's
 * hysteresis, so a tile on the edge never flickers.
 */
export const NEAR_M = 600;
/** Past this nothing is drawn: the objects' coverage (docs/SPEC.md proposals, #3082 measures them). */
export const FAR_M = 2500;
const LEAVE = 1.1;
/** Instances a family's batch makes room for at first; it grows by half when it runs out. */
const ROOM = 4096;

type Ring = 0 | 1 | 2; // near, far, past both

/** A model as one batch holds it: every family's geometries without an index, as the props' always were. */
function flat(g: THREE.BufferGeometry): THREE.BufferGeometry {
	if (!g.index) return g;
	const out = g.toNonIndexed();
	g.dispose();
	return out;
}

export function batchProps(
	route: Route,
	colors: PropColors,
	materials: Record<Family, THREE.Material>,
) {
	const meshes = new Map<Family, THREE.BatchedMesh>();
	const geometry = new Map<DrawKind, [number, number]>();
	const kinds = Object.keys(FAMILY) as DrawKind[];
	for (const family of ['trees', 'buildings', 'stock'] as const) {
		const mine = kinds.filter((k) => FAMILY[k] === family);
		const models = mine.map((k) => {
			const [toNear, toFar] = MODELS[k];
			const near = flat(toNear(colors));
			return [near, toFar === toNear ? near : flat(toFar(colors))] as const;
		});
		const vertices = [...new Set(models.flat())].reduce(
			(n, g) => n + g.attributes.position.count,
			0,
		);
		const mesh = new THREE.BatchedMesh(ROOM, vertices, 0, materials[family]);
		mesh.perObjectFrustumCulled = true;
		mesh.sortObjects = false;
		mine.forEach((k, i) => {
			const [near, far] = models[i];
			const id = mesh.addGeometry(near);
			geometry.set(k, [id, far === near ? id : mesh.addGeometry(far)]);
			near.dispose();
			if (far !== near) far.dispose();
		});
		meshes.set(family, mesh);
	}

	type Tile = {
		cx: number;
		cz: number;
		ring: Ring;
		members: [THREE.BatchedMesh, number, DrawKind][];
	};
	const tiles = new Map<string, Tile>();
	const m = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const up = new THREE.Vector3(0, 1, 0);
	const at = new THREE.Vector3();
	const size = new THREE.Vector3();

	/** A tile drawn at `ring`: near models, far ones, or none. */
	function show(tile: Tile, ring: Ring) {
		tile.ring = ring;
		for (const [mesh, id, kind] of tile.members) {
			mesh.setVisibleAt(id, ring < 2);
			if (ring !== 2) mesh.setGeometryIdAt(id, geometry.get(kind)![ring]);
		}
	}
	const ringOf = (tile: Tile, eye: THREE.Vector3, was: Ring): Ring => {
		const d = Math.hypot(tile.cx - eye.x, tile.cz - eye.z);
		// A tile crosses an edge inward at the edge, outward only 10 % past it.
		const inside = (r: number, held: boolean) =>
			held ? d <= r * LEAVE : d < r;
		return inside(NEAR_M, was === 0) ? 0 : inside(FAR_M, was <= 1) ? 1 : 2;
	};

	return {
		meshes: [...meshes.values()],
		has: (id: string) => tiles.has(id),
		/** Draws a tile's things, its centre at (cx, cz), at the ring the eye puts it in. */
		add(
			id: string,
			[cx, cz]: [number, number],
			things: readonly Drawn[],
			eye: THREE.Vector3,
		) {
			const tile: Tile = { cx, cz, ring: 0, members: [] };
			for (const p of things) {
				const mesh = meshes.get(FAMILY[p.kind])!;
				if (mesh.instanceCount >= mesh.maxInstanceCount)
					mesh.setInstanceCount(Math.ceil(mesh.maxInstanceCount * 1.5));
				const n = mesh.addInstance(geometry.get(p.kind)![0]);
				q.setFromAxisAngle(up, Math.atan2(p.turn[1], p.turn[0]));
				mesh.setMatrixAt(
					n,
					m.compose(
						at.set(p.x, yOf(route, p.base), p.z),
						q,
						size.setScalar(p.scale),
					),
				);
				tile.members.push([mesh, n, p.kind]);
			}
			// A tile comes in as though it had been near, as every tile once did: held out to its rings' far edges.
			show(tile, ringOf(tile, eye, 0));
			tiles.set(id, tile);
		},
		/** Lets a tile go: its instances' room is free for the next. */
		drop(id: string) {
			const tile = tiles.get(id);
			if (!tile) return;
			for (const [mesh, n] of tile.members) mesh.deleteInstance(n);
			tiles.delete(id);
		},
		/** Swaps each tile to the ring the eye now puts it in. */
		update(eye: THREE.Vector3) {
			for (const tile of tiles.values()) {
				const ring = ringOf(tile, eye, tile.ring);
				if (ring !== tile.ring) show(tile, ring);
			}
		},
		/** The tiles drawn now, by id: what the stage lets go. */
		ids: () => [...tiles.keys()],
	};
}

export type Batch = ReturnType<typeof batchProps>;
