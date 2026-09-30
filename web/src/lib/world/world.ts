// The ground is the place's (#3075, ADR-0081): a function of position,
// keyed by a salt in the key frame's lattice and shaped by the roads through
// it, so whichever route reaches a spot finds the same ground there. This
// dev path has one road, the route itself, in the route's own frame, until a
// served road and the map's strokes arrive (#3057, #3239). The props are
// keyed by place too (#3076), and so are the set pieces (#3077): props and set
// pieces stand through one placer, so each sees what the other stood. Nothing
// about the world is ever sent over the wire — only the route and each rider's
// distance along it.
import { roadIndex } from './field';
import { landUse } from './land';
import { markersFor, type Marker } from './markers';
import { CHUNK_M } from './place/lattice';
import type { Salt } from './place/keyed';
import { hashSeed } from './rand';
import type { Route } from '$lib/road/route';
import type { Names } from './names';
import { setPieces, type Arch, type Piece, type Sign } from './setpieces';
import { corridor, createTerrain, type TerrainMesh } from './terrain-mesh';
import { makeGround } from './terrain/ground';
import { createPlacer } from './props/placer';
import { scatter, villageSites, type Prop } from './props/scatter';
import type { Placement } from './placement/types';
import { drawnRows } from './terrain/road-profile';

export type World = {
	/** The far skyline's seed: the backdrop is still drawn from the route. */
	seed: number;
	/** The drawn ground's extent: minX, minZ, maxX, maxZ. */
	bounds: [number, number, number, number];
	mesh: TerrainMesh; // chunk by chunk on the lattice, fine near the road, one crack-free surface
	/** The drawn ground's outline, as segments: where a plinth stands. */
	rim: number[];
	heightAt: (x: number, z: number) => number; // the drawn surface, for anything that stands on it
	roadSurfaceAt: (x: number, z: number) => number | null;
	/** Every prop as #3219's gates see it, in the order it was admitted. */
	placements: Placement[];
	markers: Marker[];
	pieces: Piece[];
	signs: Sign[];
	arches: Arch[];
	names: Names;
	/** What stands beside the road, keyed by place (#3076). */
	props: Prop[];
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
	const { nearest } = roadIndex(route);
	const { heightAt, biomeAt } = terrain;
	const { roadSurfaceAt } = ground;

	const place = {
		salt: opts.salt ?? DEV_SALT,
		ground,
		heightAt,
		biomeAt,
		chunks: cover.chunks,
	};
	const villages = villageSites(place);
	// Where the ribbon is drawn it is the ground a post stands on.
	const placer = createPlacer(
		(x, z) => roadSurfaceAt(x, z) ?? heightAt(x, z),
		ground.lines,
	);
	// Set pieces stand first: a fountain in a village wins its spot over a tree.
	const set = setPieces({ ...place, placer, villages });
	const placed = scatter(place, placer, villages);
	const villageNames = villages
		.map((v) => ({
			d: (nearest(v.x, v.z)?.i ?? 0) * route.step,
			name: v.name,
		}))
		.sort((a, b) => a.d - b.d);
	const markers = markersFor(route, villageNames);
	return {
		seed,
		bounds,
		mesh,
		rim: terrain.rim(cover.chunks),
		placements: placer.placements,
		heightAt,
		roadSurfaceAt,
		props: placed.props,
		villageNames,
		markers,
		pieces: set.pieces,
		signs: set.signs,
		arches: set.arches,
		names: set.names,
	};
}
