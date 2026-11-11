import * as THREE from 'three';
import type { Route } from '#lib/road/route.ts';
import { yOf } from '../geometry';
import { LEAVE } from '../ground-stream';
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
	// Anything over 2 m fades near the sightline (#3220 O7), so it sits in a fading family; the stock below is low and never blocks.
	cow: 'stock',
	rock: 'stock',
	bench: 'stock',
	woodpile: 'stock',
	bales: 'stock',
	wayside: 'buildings',
	signpost: 'buildings',
	fountain: 'stock',
	fence: 'stock',
	snowpole: 'buildings',
	delineator: 'stock',
	lamp: 'buildings',
	steep: 'buildings',
	cattle: 'buildings',
	mirror: 'buildings',
	milkcans: 'stock',
	cross: 'buildings',
	flag0: 'buildings',
	flag1: 'buildings',
	flag2: 'buildings',
	flag3: 'buildings',
};

type Models = (c: PropColors) => THREE.BufferGeometry;
type Form = [near: Models, far: Models];
const flag =
	(i: number): Models =>
	(c) =>
		P.flagpole(c, c.flags[i]);
/**
 * Each kind's forms, near and far. A tree is drawn in the form its place
 * chose (forest.ts `formOf`), so a stand is never a row of one cone (#4256);
 * its first form is the kind's own, the one kit.ts reads its footprint off.
 * A kit with no stand-in is its own: at a few dozen triangles it is the far
 * model too.
 */
const MODELS: Record<DrawKind, Form[]> = {
	spruce: [
		[P.spruce, P.spruceFar],
		[P.spruceSlender, P.spruceSlenderFar],
		[P.fir, P.firFar],
	],
	broadleaf: [
		[P.broadleaf, P.broadleafFar],
		[P.broadleafRound, P.broadleafRoundFar],
		[P.broadleafTall, P.broadleafTallFar],
	],
	linden: [[P.linden, P.linden]],
	house: [[P.house, P.houseFar]],
	church: [[P.church, P.churchFar]],
	barn: [[P.barn, P.barnFar]],
	hut: [[P.hut, P.hutFar]],
	chapel: [[P.chapel, P.chapel]],
	cow: [[P.cow, P.cowFar]],
	rock: [[P.rock, P.rock]],
	bench: [[P.bench, P.bench]],
	woodpile: [[P.woodpile, P.woodpile]],
	bales: [[P.bales, P.bales]],
	wayside: [[P.wayside, P.wayside]],
	signpost: [[P.signpost, P.signpost]],
	fountain: [[P.fountain, P.fountain]],
	fence: [[P.fence, P.fence]],
	snowpole: [[P.snowpole, P.snowpole]],
	delineator: [[P.delineator, P.delineator]],
	lamp: [[P.lamp, P.lamp]],
	steep: [[P.steepSign, P.steepSign]],
	cattle: [[P.cattleSign, P.cattleSign]],
	mirror: [[P.mirror, P.mirror]],
	milkcans: [[P.milkcans, P.milkcans]],
	cross: [[P.summitCross, P.summitCross]],
	flag0: [[flag(0), flag(0)]],
	flag1: [[flag(1), flag(1)]],
	flag2: [[flag(2), flag(2)]],
	flag3: [[flag(3), flag(3)]],
};

/**
 * What lights after dusk, drawn beside its model in the lights' own batch
 * (lights.ts): in the near ring only, where a window is more than a speck.
 */
const LIT: Partial<Record<DrawKind, Models>> = {
	house: P.houseLit,
	hut: P.hutLit,
	lamp: P.lampLit,
};

/** One thing to draw: its model, where it stands, how it is turned and sized. */
export type Drawn = {
	kind: DrawKind;
	/** Which of its kind's forms it is drawn in; the kind's own when absent. */
	form?: number;
	/** A tree's shade, a keyed unit: TONE darker at 0, lighter at 1, its colours' own when absent. */
	tone?: number;
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
/** Tiles are settled out to this many far rings, so a tile is standing before the eye is within its fade (#3220 O8). */
export const FETCH_AHEAD = 1.2;
/** How far a tree's shade strays from its colours' either way (#4256): no two neighbours one green. */
export const TONE = 0.45;
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
	materials: Record<Family | 'lights', THREE.Material>,
) {
	const meshes = new Map<Family | 'lights', THREE.BatchedMesh>();
	/** Each kind's forms, each as its near and far geometry's id in its family's batch. */
	const geometry = new Map<DrawKind, [number, number][]>();
	const kinds = Object.keys(FAMILY) as DrawKind[];
	/** A batch for `models`, its instances culled one by one. */
	function batch(models: THREE.BufferGeometry[], material: THREE.Material) {
		const vertices = [...new Set(models)].reduce(
			(n, g) => n + g.attributes.position.count,
			0,
		);
		const mesh = new THREE.BatchedMesh(ROOM, vertices, 0, material);
		// Three measures a batch's own bounds once, on its first frame, and its tiles move on (#4260).
		mesh.frustumCulled = false;
		mesh.perObjectFrustumCulled = true;
		mesh.sortObjects = false;
		return mesh;
	}
	for (const family of ['trees', 'buildings', 'stock'] as const) {
		const mine = kinds.filter((k) => FAMILY[k] === family);
		const models = mine.map((k) =>
			MODELS[k].map(([toNear, toFar]) => {
				const near = flat(toNear(colors));
				return [near, toFar === toNear ? near : flat(toFar(colors))] as const;
			}),
		);
		const mesh = batch(models.flat(2), materials[family]);
		mine.forEach((k, i) =>
			geometry.set(
				k,
				models[i].map(([near, far]) => {
					const id = mesh.addGeometry(near);
					const ids: [number, number] = [
						id,
						far === near ? id : mesh.addGeometry(far),
					];
					near.dispose();
					if (far !== near) far.dispose();
					return ids;
				}),
			),
		);
		meshes.set(family, mesh);
	}
	const lit = Object.entries(LIT).map(
		([k, model]) => [k as DrawKind, flat(model(colors))] as const,
	);
	const lights = batch(
		lit.map(([, g]) => g),
		materials.lights,
	);
	const litId = new Map(
		lit.map(([k, g]) => {
			const id = lights.addGeometry(g);
			g.dispose();
			return [k, id];
		}),
	);
	meshes.set('lights', lights);
	/** The geometry a thing is drawn with at `ring`: its form's, or its kind's own where it has no such form. */
	const idOf = (kind: DrawKind, form: number, ring: 0 | 1) => {
		const forms = geometry.get(kind)!;
		return (forms[form] ?? forms[0])[ring];
	};

	type Tile = {
		cx: number;
		cz: number;
		ring: Ring;
		/** Each instance: its batch, its id, its kind and form; form −1 is a kind's lights. */
		members: [THREE.BatchedMesh, number, DrawKind, number][];
	};
	const tiles = new Map<string, Tile>();
	const m = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const up = new THREE.Vector3(0, 1, 0);
	const at = new THREE.Vector3();
	const size = new THREE.Vector3();
	const shade = new THREE.Color();

	/** A tile drawn at `ring`: near models, far ones, or none. */
	function show(tile: Tile, ring: Ring) {
		tile.ring = ring;
		for (const [mesh, id, kind, form] of tile.members) {
			if (form < 0) {
				mesh.setVisibleAt(id, ring === 0);
				continue;
			}
			mesh.setVisibleAt(id, ring < 2);
			if (ring !== 2) mesh.setGeometryIdAt(id, idOf(kind, form, ring));
		}
	}
	// The quality ladder's lower rungs draw the near ring only (#3295): the far one's tiles stay, hidden.
	let far = true;
	const ringOf = (tile: Tile, eye: THREE.Vector3, was: Ring): Ring => {
		const d = Math.hypot(tile.cx - eye.x, tile.cz - eye.z);
		// A tile crosses an edge inward at the edge, outward only 10 % past it.
		const inside = (r: number, held: boolean) =>
			held ? d <= r * LEAVE : d < r;
		if (inside(NEAR_M, was === 0)) return 0;
		return far && inside(FAR_M, was <= 1) ? 1 : 2;
	};

	/** A new instance of geometry `geo` in `mesh`, the batch grown by half when it is full. */
	function instance(mesh: THREE.BatchedMesh, geo: number) {
		if (mesh.instanceCount >= mesh.maxInstanceCount)
			mesh.setInstanceCount(Math.ceil(mesh.maxInstanceCount * 1.5));
		return mesh.addInstance(geo);
	}

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
				const form = p.form ?? 0;
				const n = instance(mesh, idOf(p.kind, form, 0));
				q.setFromAxisAngle(up, Math.atan2(p.turn[1], p.turn[0]));
				mesh.setMatrixAt(
					n,
					m.compose(
						at.set(p.x, yOf(route, p.base), p.z),
						q,
						size.setScalar(p.scale),
					),
				);
				// Every tree sets its shade: an instance's room is reused, its last shade with it.
				if (FAMILY[p.kind] === 'trees')
					mesh.setColorAt(
						n,
						shade.setScalar(1 + TONE * (2 * (p.tone ?? 0.5) - 1)),
					);
				tile.members.push([mesh, n, p.kind, form]);
				const light = litId.get(p.kind);
				if (light === undefined) continue;
				const l = instance(lights, light);
				lights.setMatrixAt(l, m);
				tile.members.push([lights, l, p.kind, -1]);
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
		/** Shows or hides the far ring from the next update(): nothing is built or let go. */
		setFar(on: boolean) {
			far = on;
		},
		/** The tiles drawn now, by id: what the stage lets go. */
		ids: () => [...tiles.keys()],
	};
}
