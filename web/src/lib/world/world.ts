// The ground is the place's (#3075, ADR-0081): a function of position,
// keyed by a salt in the key frame's lattice and shaped by the roads through
// it, so whichever route reaches a spot finds the same ground there. This
// dev path has one road, the route itself, in the route's own frame, until a
// served road and the map's strokes arrive (#3057, #3239). The props are
// keyed by place too (#3076), and so are the set pieces (#3077): both are
// settled a 250 m tile at a time, when something first asks for the tile
// (#3699), so a ride pays for the ground around it and never for the whole
// route. Nothing about the world is ever sent over the wire — only the route
// and each rider's distance along it.
import { roadIndex } from './field';
import { landUse } from './land';
import { markersFor, type Marker } from './markers';
import { CHUNK_M } from './place/lattice';
import type { Salt } from './place/keyed';
import { hashSeed } from './rand';
import type { Route } from '$lib/road/route';
import type { Names } from './names';
import { setPieces, type Arch, type Piece, type Sign } from './setpieces';
import type { Passing } from './placement/stream';
import {
	corridor,
	createTerrain,
	gridAt,
	placeLevel,
	type Coverage,
	type Edges,
	type Grid,
	type Level,
	type TerrainMesh,
} from './terrain-mesh';
import { makeGround } from './terrain/ground';
import type { Line } from './terrain/lines';
import { createPlacer } from './props/placer';
import { scatter, villageSites, type Prop } from './props/scatter';
import { standTiles, type Stood } from './props/stand';
import type { Placement } from './placement/types';
import { drawnRows } from './terrain/road-profile';

export type World = {
	/** The far skyline's seed: the backdrop is still drawn from the route. */
	seed: number;
	/** The corridor's extent, every chunk within its margin of a road: minX, minZ, maxX, maxZ. */
	bounds: [number, number, number, number];
	/** The whole corridor as one mesh, built when first asked: the diorama's ground. A ride streams grid() instead. */
	readonly mesh: TerrainMesh;
	/** The corridor's outline, as segments: where a plinth stands. Built with the mesh. */
	readonly rim: number[];
	/** How finely the place draws each chunk: fine near a road, coarse elsewhere, wherever the eye is. */
	level: Coverage;
	/** A chunk's ground at the place's level, built on this thread and kept: what the props stand on. */
	grid: (ci: number, cj: number) => Grid | null;
	/** That, if something has built it already, without building it. */
	peek: (ci: number, cj: number) => Grid | null | undefined;
	/** Any chunk's ground at any level, built on this thread and not kept: the same bytes the build worker makes of `roads` and `salt`. */
	gridAt: (ci: number, cj: number, level: Level, edges: Edges) => Grid;
	/** The roads the ground is shaped by, and the salt it is keyed by: what a worker builds the same ground from. */
	roads: Line[];
	salt: Salt;
	heightAt: (x: number, z: number) => number; // the drawn surface, for anything that stands on it
	roadSurfaceAt: (x: number, z: number) => number | null;
	/**
	 * What one 250 m tile stands, settled the first time it is asked (#3699):
	 * a ride asks the tiles around its eye as it goes, so mount time stops
	 * growing with the route.
	 */
	tile: (ti: number, tj: number) => Stood;
	/** Whether a tile is settled already. */
	settled: (ti: number, tj: number) => boolean;
	/** Every tile whose centre lies within `r` metres of (x, z), nearest first. */
	tilesWithin: (x: number, z: number, r: number) => [number, number][];
	/** Every tile within reach of the roads, settled: the whole corridor's things, for the diorama and the tests. Slow on a long route. */
	readonly everything: Stood;
	/** What a rider passes along each stroke of the whole corridor, as #3221's O9 reads it. */
	readonly streams: Passing[][];
	/** The whole corridor's, as `everything` has them. */
	readonly placements: Placement[];
	readonly pieces: Piece[];
	readonly signs: Sign[];
	readonly arches: Arch[];
	readonly props: Prop[];
	markers: Marker[];
	names: Names;
	/** Where each village stands along the route, for the markers and set pieces that read it so. */
	villageNames: { d: number; name: string }[];
};

/** The dev world's salt. Its road is synthetic, so a public salt matches no place; a served road brings its own (#3225). */
export const DEV_SALT: Salt = [0x57a770e0, 0x0de5a1e0, 0x5eed5eed, 0x00c0ffee];

export function generate(
	route: Route,
	opts: { margin?: number; salt?: Salt } = {},
): World {
	const seed = hashSeed(
		`${route.name}:${Math.round(route.length)}:${Math.round(route.gain)}`,
	);

	// The ground's road is the drawn one, so earthworks and furniture follow the ribbon.
	const rows = drawnRows(route);
	const salt = opts.salt ?? DEV_SALT;
	const roads: Line[] = [
		{
			key: 'route',
			x: rows.map((p) => p.x),
			z: rows.map((p) => p.z),
			h: rows.map((p) => p.ele),
		},
	];
	const ground = makeGround(roads, { salt });
	const margin = opts.margin ?? 1400;
	// The corridor's chunks are the diorama's alone: a ride never lists them.
	let cover: ReturnType<typeof corridor> | null = null;
	const chunks = () => (cover ??= corridor(ground.lines, margin)).chunks;
	// The place's levels, not the corridor's: a streamed chunk is the one the props stood on.
	const level = placeLevel(ground.lines);
	const land = landUse(ground.noise);
	const terrain = createTerrain(ground, level, land);
	const bounds = boundsOf(ground.lines, margin);
	const { nearest } = roadIndex(route);
	const { heightAt, biomeAt } = terrain;
	const { roadSurfaceAt } = ground;

	const place = { salt, ground, heightAt, biomeAt };
	const villages = villageSites(place);
	// Where the ribbon is drawn it is the ground a post stands on.
	const placer = createPlacer(
		(x, z) => roadSurfaceAt(x, z) ?? heightAt(x, z),
		ground.lines,
	);
	const set = setPieces({ ...place, placer, villages });
	const tiles = standTiles(scatter(place, placer, villages), set);
	let all: Stood | null = null;
	/** Every tile within reach of a road: a tree stands within 700 m of one, and its tile's centre within half a diagonal more. */
	function everything(): Stood {
		if (all) return all;
		const seen = new Map<string, [number, number]>();
		for (const l of ground.lines)
			for (let i = 0; i < l.x.length; i += 50)
				for (const t of tiles.within(l.x[i], l.z[i], 900))
					seen.set(`${t[0]}:${t[1]}`, t);
		const stood = [...seen.values()]
			.sort((a, b) => a[1] - b[1] || a[0] - b[0])
			.map(([ti, tj]) => tiles.tile(ti, tj));
		const merge = <K extends keyof Stood>(k: K) =>
			stood.flatMap((t) => t[k] as unknown[]) as Stood[K];
		all = {
			props: merge('props'),
			pieces: merge('pieces'),
			standing: merge('standing'),
			signs: merge('signs'),
			arches: merge('arches'),
			placements: merge('placements'),
		};
		return all;
	}
	const villageNames = villages
		.map((v) => ({
			d: (nearest(v.x, v.z)?.i ?? 0) * route.step,
			name: v.name,
		}))
		.sort((a, b) => a.d - b.d);
	const markers = markersFor(route, villageNames);
	let whole: { mesh: TerrainMesh; rim: number[] } | null = null;
	const diorama = () =>
		(whole ??= {
			mesh: terrain.mesh(chunks()),
			rim: terrain.rim(chunks()),
		});
	return {
		seed,
		bounds,
		get mesh() {
			return diorama().mesh;
		},
		get rim() {
			return diorama().rim;
		},
		level,
		grid: terrain.chunk,
		peek: terrain.peek,
		gridAt: (ci, cj, at, edges) => gridAt(ground, land, ci, cj, at, edges),
		roads,
		salt,
		tile: tiles.tile,
		settled: tiles.has,
		tilesWithin: tiles.within,
		get everything() {
			return everything();
		},
		get streams() {
			return set.streams(everything().standing);
		},
		get placements() {
			return everything().placements;
		},
		get pieces() {
			return everything().pieces;
		},
		get signs() {
			return everything().signs;
		},
		get arches() {
			return everything().arches;
		},
		get props() {
			return everything().props;
		},
		heightAt,
		roadSurfaceAt,
		villageNames,
		markers,
		names: set.names,
	};
}

/**
 * The corridor's extent from its roads alone: every chunk within `margin` of
 * a road's point, as corridor() lists them, without listing them.
 */
function boundsOf(
	lines: readonly Line[],
	margin: number,
): [number, number, number, number] {
	let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
	for (const l of lines)
		for (let i = 0; i < l.x.length; i++) {
			x0 = Math.min(x0, l.x[i]);
			z0 = Math.min(z0, l.z[i]);
			x1 = Math.max(x1, l.x[i]);
			z1 = Math.max(z1, l.z[i]);
		}
	// The lowest chunk whose far edge is within the margin, the highest whose near edge is.
	const low = (v: number) => Math.ceil((v - margin) / CHUNK_M - 1) * CHUNK_M;
	const high = (v: number) =>
		(Math.floor((v + margin) / CHUNK_M) + 1) * CHUNK_M;
	return [low(x0), low(z0), high(x1), high(z1)];
}
