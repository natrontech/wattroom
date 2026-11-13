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
import type { Biome } from './biome';
import { roadIndex } from './field';
import { landUse } from './land';
import { markersFor, type Marker } from './markers';
import { CHUNK_M } from './place/lattice';
import { keyer, type Salt } from './place/keyed';
import { forest } from './props/forest';
import { hashSeed } from './rand';
import type { Route } from '#lib/road/route.ts';
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
import { drawnRows, FORMATION } from './terrain/road-profile';
import { othersOf, sceneOf, type Water } from './designed';
import { sideRoads, type SideRoad } from './side-roads';

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
	/** A designed road's scene, by its id (designed.ts): what a worker shapes the same land from. */
	scene?: string;
	/** The scene's water, drawn as sheets: its lakes and rivers, and its streams as the ground laid them. */
	waters: Water[];
	/** The level of the scene's water over (x, z), or null on land. */
	waterAt: (x: number, z: number) => number | null;
	/** Where the road is carried over the ground, in metres along it: its bridges. */
	bridges: [from: number, to: number][];
	/** The map's other roads where they leave this one (side-roads.ts), and each one's bridges: drawn, never ridden. */
	sides: (SideRoad & { bridges: [from: number, to: number][] })[];
	/** Whether (x, z) lies under a gallery's roof: nothing grows or stands there. */
	roofedAt: (x: number, z: number) => boolean;
	/** Where the road runs under a gallery's roof, in metres along it. */
	galleries: [from: number, to: number][];
	/** The ground at (x, z) as the place has it, earthworks and all, without drawing it: what the road's rails are read off (scenery.ts). */
	groundAt: (x: number, z: number) => number;
	heightAt: (x: number, z: number) => number; // the drawn surface, for anything that stands on it
	/** What grows at (x, z); null where no ground is drawn. What the ride hears beside the road (#3186). */
	biomeAt: (x: number, z: number) => Biome | null;
	roadSurfaceAt: (x: number, z: number) => number | null;
	/** Whether (x, z) keeps `base` metres from every road, more on a bend's inside (terrain/ground.ts). */
	clearOf: (x: number, z: number, base: number) => boolean;
	/** The forest's stand noise at (x, z), props/forest.ts's: below 0 a gap, above it a group. */
	standAt: (x: number, z: number) => number;
	/**
	 * What one 250 m tile stands, settled the first time it is asked (#3699):
	 * a ride asks the tiles around its eye as it goes, so mount time stops
	 * growing with the route.
	 */
	tile: (ti: number, tj: number) => Stood;
	/** Whether a tile is settled already. */
	settled: (ti: number, tj: number) => boolean;
	/** Lets go of the tiles and ground kept farther than `r` from (x, z), so a long ride holds only what is around it (#3851). */
	forget: (x: number, z: number, r: number) => void;
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
	// A designed road's scene shapes the land (designed.ts), and where it drops away under the road, the road is carried over it.
	const layout = sceneOf(route.scene);
	// The map's other roads, where they leave this one (side-roads.ts): the ground is shaped by them as by the road ridden.
	const beside = sideRoads(route, othersOf(route.scene));
	const sideRows = beside.map((side) => drawnRows(side.route));
	sideRows.forEach((r, j) =>
		roads.push({
			key: `side:${j}`,
			x: r.map((p) => p.x),
			z: r.map((p) => p.z),
			h: r.map((p) => p.ele),
		}),
	);
	const cut = layout && makeGround(roads, { salt, scene: layout }).natural;
	const uncut = layout && makeGround(roads, { salt }).natural;
	const spansOf = (r: typeof rows, line: Line) => {
		const spans = cut && uncut ? bridgesOf(r, cut, uncut) : [];
		if (spans.length > 0) {
			const open = new Uint8Array(r.length);
			for (const [from, to] of spans)
				open.fill(1, Math.round(from / ROW_M), Math.round(to / ROW_M) + 1);
			line.open = open;
		}
		return spans;
	};
	const bridges = spansOf(rows, roads[0]);
	const sides = beside.map((side, j) => ({
		...side,
		bridges: spansOf(sideRows[j], roads[j + 1]),
	}));
	const ground = makeGround(roads, { salt, scene: layout });
	// The scene as the ground laid it: its streams run where that ground falls.
	const scene = ground.scene;
	const margin = opts.margin ?? 1400;
	// The corridor's chunks are the diorama's alone: a ride never lists them.
	let cover: ReturnType<typeof corridor> | null = null;
	const chunks = () => (cover ??= corridor(ground.lines, margin)).chunks;
	// The place's levels, not the corridor's: a streamed chunk is the one the props stood on.
	const level = placeLevel(
		ground.lines,
		(scene?.waters ?? [])
			.filter((w) => w.run)
			.map((w) => ({
				x: w.outline.map((p) => p[0]),
				z: w.outline.map((p) => p[1]),
			})),
	);
	const land = landUse(ground.noise, scene);
	const terrain = createTerrain(ground, level, land);
	const bounds = boundsOf(ground.lines, margin);
	const { nearest } = roadIndex(route);
	const { heightAt, biomeAt } = terrain;
	const { roadSurfaceAt } = ground;

	const place = { salt, ground, heightAt, biomeAt };
	// The same stands scatter.ts grows its trees in (the place has no origin of its own: east is x, north −z).
	const woods = forest(keyer(salt, 'tree')(-1, -1, -1));
	const villages = villageSites(place);
	// Where the ribbon is drawn it is the ground a post stands on.
	const placer = createPlacer(
		(x, z) => roadSurfaceAt(x, z) ?? heightAt(x, z),
		ground.lines,
	);
	const set = setPieces({ ...place, placer, villages });
	const tiles = standTiles(
		scatter(place, placer, villages),
		set,
		undefined,
		// Nor under a gallery's roof.
		scene && ((x, z) => scene.waterAt(x, z) !== null || roofedAt(x, z)),
	);
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
	const galleries = (scene?.galleries ?? []).flatMap(([a, b]) => {
		const from = nearest(a[0], a[1]);
		const to = nearest(b[0], b[1]);
		// A gallery on another of the map's roads is not this road's.
		if (!from || !to || from.d > 30 || to.d > 30) return [];
		const span = [from.i * route.step, to.i * route.step].sort((p, q) => p - q);
		return [[span[0], span[1]] as [number, number]];
	});
	const roofedAt = (x: number, z: number) => {
		if (galleries.length === 0) return false;
		const hit = nearest(x, z);
		if (!hit || hit.d > FORMATION + 2) return false;
		const d = hit.i * route.step;
		return galleries.some(([a, b]) => d >= a - 4 && d <= b + 4);
	};
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
		...(route.scene !== undefined && scene && { scene: route.scene }),
		waters: scene?.waters ?? [],
		waterAt: (x, z) => scene?.waterAt(x, z) ?? null,
		bridges,
		sides,
		galleries,
		roofedAt,
		groundAt: ground.heightAt,
		tile: tiles.tile,
		settled: tiles.has,
		forget(x, z, r) {
			tiles.forget(x, z, r);
			terrain.forget(x, z, r);
		},
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
		biomeAt,
		roadSurfaceAt,
		clearOf: ground.clearOf,
		standAt: (x, z) => woods.groupAt(x, -z),
		villageNames,
		markers,
		names: set.names,
	};
}

/** Metres between the ground's rows of the road (drawnRows). */
const ROW_M = 2;
/** A road this far over the designed ground is carried, not banked up: an embankment that high is 12 m wide at its foot each side. */
const BRIDGE_OVER_M = 4;
/** A bridge is this long at the least, and stands this far onto the land at each end. */
const BRIDGE_MIN_M = 12;
const ABUTMENT_M = 8;

/**
 * The stretches of the road its scene's ground drops away under, in metres
 * along it: where a lake's arm or a river's gorge lies under the line, the
 * road is a bridge. Read off the ground as designed, so a bridge stands
 * where the water is, wherever the road was drawn.
 */
export function bridgesOf(
	rows: readonly { x: number; z: number; ele: number }[],
	natural: (x: number, z: number) => number,
	/** The ground as the generator alone has it: a bridge stands only where the scene cut it away, never over a hollow of the generator's, which a road fills. */
	uncut: (x: number, z: number) => number = () => Infinity,
): [number, number][] {
	const out: [number, number][] = [];
	let from = -1;
	for (let k = 0; k <= rows.length; k++) {
		const under = k < rows.length ? natural(rows[k].x, rows[k].z) : 0;
		const over =
			k < rows.length &&
			rows[k].ele - under > BRIDGE_OVER_M &&
			uncut(rows[k].x, rows[k].z) - under > 1;
		if (over && from < 0) from = k;
		if (!over && from >= 0) {
			if ((k - from) * ROW_M >= BRIDGE_MIN_M) {
				const a = Math.max(0, from * ROW_M - ABUTMENT_M);
				const b = Math.min(
					(rows.length - 1) * ROW_M,
					(k - 1) * ROW_M + ABUTMENT_M,
				);
				// Two spans a pier's reach apart are one bridge.
				const last = out[out.length - 1];
				if (last && a - last[1] < 2 * ABUTMENT_M) last[1] = b;
				else out.push([a, b]);
			}
			from = -1;
		}
	}
	return out;
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
