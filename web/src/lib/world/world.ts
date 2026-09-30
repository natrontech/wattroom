// The ground is the place's (#3075, ADR-0081): a function of position,
// keyed by a salt in the key frame's lattice and shaped by the roads through
// it, so whichever route reaches a spot finds the same ground there. This
// dev path has one road, the route itself, in the route's own frame, until a
// served road and the map's strokes arrive (#3057, #3239). The props and set
// pieces still draw from the route's seed until they are keyed by place too
// (#3076, #3077). Nothing about the world is ever sent over the wire — only
// the route and each rider's distance along it.
import { dress, type Props } from './dress';
import { makeField, roadIndex } from './field';
import { landUse } from './land';
import { markersFor, type Marker } from './markers';
import { CHUNK_M } from './place/lattice';
import type { Salt } from './place/keyed';
import { hashSeed, prng } from './rand';
import type { Route } from '$lib/road/route';
import type { Names } from './names';
import { setPieces, type Arch, type Piece, type Sign } from './setpieces';
import { corridor, createTerrain, type TerrainMesh } from './terrain-mesh';
import { makeGround } from './terrain/ground';
import { drawnRows } from './terrain/road-profile';

export type World = {
	/** The props' and set pieces' seed, until #3076 and #3077 key them by place. */
	seed: number;
	/** The drawn ground's extent: minX, minZ, maxX, maxZ. */
	bounds: [number, number, number, number];
	mesh: TerrainMesh; // chunk by chunk on the lattice, fine near the road, one crack-free surface
	/** The drawn ground's outline, as segments: where a plinth stands. */
	rim: number[];
	heightAt: (x: number, z: number) => number; // the drawn surface, for anything that stands on it
	roadSurfaceAt: (x: number, z: number) => number | null;
	markers: Marker[];
	pieces: Piece[];
	signs: Sign[];
	arches: Arch[];
	names: Names;
} & Props;

/** The dev world's salt. Its road is synthetic, so a public salt matches no place; a served road brings its own (#3225). */
export const DEV_SALT: Salt = [0x57a770e0, 0x0de5a1e0, 0x5eed5eed, 0x00c0ffee];

export function generate(
	route: Route,
	opts: { margin?: number; salt?: Salt } = {},
): World {
	const seed = hashSeed(
		`${route.name}:${Math.round(route.length)}:${Math.round(route.gain)}`,
	);
	const rand = prng(seed);

	// The ground's road is the drawn one, so earthworks and furniture follow the ribbon.
	const rows = drawnRows(route);
	const ground = makeGround(
		[
			{
				key: 'route',
				x: rows.map((p) => p.x),
				z: rows.map((p) => p.z),
				h: rows.map((p) => p.ele),
			},
		],
		{ salt: opts.salt ?? DEV_SALT },
	);
	const cover = corridor(ground.lines, opts.margin ?? 1400);
	const terrain = createTerrain(ground, cover.level, landUse(ground.noise));
	const mesh = terrain.mesh(cover.chunks);
	const bounds: World['bounds'] = [Infinity, Infinity, -Infinity, -Infinity];
	for (const [ci, cj] of cover.chunks) {
		bounds[0] = Math.min(bounds[0], ci * CHUNK_M);
		bounds[1] = Math.min(bounds[1], cj * CHUNK_M);
		bounds[2] = Math.max(bounds[2], (ci + 1) * CHUNK_M);
		bounds[3] = Math.max(bounds[3], (cj + 1) * CHUNK_M);
	}
	const field = makeField(route);
	const { nearest } = roadIndex(route);
	const { heightAt, biomeAt } = terrain;
	const { roadSurfaceAt } = ground;

	const props = dress(route, {
		rand,
		field,
		nearest,
		heightAt,
		biomeAt,
		roadSurfaceAt,
		roadDistAt: ground.roadDist,
		bounds,
	});
	const markers = markersFor(route, props.villageNames);
	const set = setPieces(route, markers, {
		rand,
		field,
		nearest,
		heightAt,
		biomeAt,
		roadSurfaceAt,
		villages: props.villageNames,
	});
	return {
		seed,
		bounds,
		mesh,
		rim: terrain.rim(cover.chunks),
		heightAt,
		roadSurfaceAt,
		...props,
		markers,
		...set,
	};
}
