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
import { hashSeed, smoothstep } from './rand';
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
import {
	drawnRows,
	FORMATION,
	GRAVEL_W,
	ROAD_W,
	SHOULDER,
} from './terrain/road-profile';
import {
	ARM_M,
	armsOf,
	armWiden,
	othersOf,
	ringSignAt,
	ringsOf,
	roundaboutsOf,
	sceneOf,
	type Water,
} from './designed';
import { offRoad, sideRoads, type Mouth, type SideRoad } from './side-roads';
import { JOINED, JOINS } from './crossings';
import { carriagewayAt, liftOf, yOf } from './road-surface';
import {
	GALLERY,
	GALLERY_BACK,
	PORTAL,
	PORTAL_M,
	TUBE,
	UNDER_ROOF,
} from './structure-sizes';

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
	/** The map's other roads where they leave this one (side-roads.ts), and each one's bridges and tunnels: drawn, never ridden. */
	sides: (SideRoad & {
		bridges: [from: number, to: number][];
		tunnels: [from: number, to: number][];
	})[];
	/** The road ridden as its ribbon is drawn: with the roads that join it (Route.meets), and hidden where it runs on a roundabout's ring. */
	ridden: Route;
	/** Metres from (x, z) to the nearest of the roads a mouth's junction is made of (Mouth.near). */
	offJunction: (m: Mouth, x: number, z: number) => number;
	/** Whether something reaching `reach` metres round (x, z) would stand under a gallery's roof or through its wall, or in a tunnel or before its portal: nothing grows or stands there. */
	roofedAt: (x: number, z: number, reach?: number) => boolean;
	/** Where the road runs under a gallery's roof, in metres along it. */
	galleries: [from: number, to: number][];
	/** Where the road runs through the hill, in metres along it, portal to portal (designed.ts tunnels). */
	tunnels: [from: number, to: number][];
	/**
	 * Under a roof at (x, z), a tunnel's vault or a gallery's slab: the
	 * road's height there and the most an eye may stand, in the scene's
	 * heights (yOf). Before a tunnel's portal the most rises a half metre a
	 * metre out, so a camera comes down to it as it comes in. Null in the open.
	 */
	roofAt: (
		x: number,
		z: number,
	) => { floor: number | null; most: number } | null;
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
	const rings = ringsOf(route.scene);
	const kept = [...rings, ...armsOf(route.scene)];
	const others = othersOf(route.scene);
	if (layout) drape(route, others, salt, layout);
	const beside = sideRoads(route, others, kept).map((side) =>
		side.route.gravel ? { ...side, route: apron(side) } : side,
	);
	const sideRows = beside.map((side) => drawnRows(side.route));
	sideRows.forEach((r, j) =>
		roads.push({
			// A gravel lane's line is a lane's: the ground is shaped by it, and nothing is signed along it (setpieces.ts).
			key:
				j < kept.length
					? `ring:${j}`
					: beside[j].route.gravel
						? `lane:${j}`
						: `side:${j}`,
			x: r.map((p) => p.x),
			z: r.map((p) => p.z),
			h: r.map((p) => p.ele),
			...(beside[j].route.gravel && { light: true }),
		}),
	);
	// A tunnel's road runs through the hill (designed.ts): past its portal's cut-and-cover the ground is left closed over it (terrain/ground.ts Line.bore).
	const tunnelsOf = (r: typeof rows, line: Line) => {
		const spans = layout ? spansAlong(r, layout.tunnels) : [];
		if (spans.length > 0) {
			const bore = new Uint8Array(r.length);
			for (const [from, to] of spans)
				if (to - from > 2 * PORTAL_M)
					bore.fill(
						1,
						Math.ceil((from + PORTAL_M) / ROW_M),
						Math.floor((to - PORTAL_M) / ROW_M) + 1,
					);
			line.bore = bore;
		}
		return spans;
	};
	const tunnels = tunnelsOf(rows, roads[0]);
	const sideTunnels = sideRows.map((r, j) => tunnelsOf(r, roads[j + 1]));
	const shaped = layout && makeGround(roads, { salt, scene: layout });
	const cut = shaped?.natural;
	const uncut = layout && makeGround(roads, { salt }).natural;
	// Where a stream runs under the road, a short bridge over it, so it is seen going under.
	const streams = (shaped?.scene?.waters ?? []).filter((w) => w.run);
	const spansOf = (r: typeof rows, line: Line, through: [number, number][]) => {
		const spans =
			cut && uncut
				? withCulverts(
						bridgesOf(r, cut, uncut),
						culvertsOf(r, streams),
						through,
						// No stream's bridge under a gallery's roof: the road there is the gallery's.
						spansAlong(r, layout?.galleries ?? []),
					)
				: [];
		if (spans.length > 0) {
			const open = new Uint8Array(r.length);
			for (const [from, to] of spans)
				open.fill(1, Math.round(from / ROW_M), Math.round(to / ROW_M) + 1);
			line.open = open;
		}
		return spans;
	};
	const bridges = spansOf(rows, roads[0], tunnels);
	const sides = beside.map((side, j) => ({
		...side,
		bridges: spansOf(sideRows[j], roads[j + 1], sideTunnels[j]),
		tunnels: sideTunnels[j],
	}));
	// At each mouth the two roads' paint reads the other's line (crossings.ts): the side road joins, the road met is joined.
	const meets: NonNullable<Route['meets']> = [];
	const slice = (r: Route, from: number, to: number) => {
		const a = Math.max(0, Math.floor(from / r.step));
		const b = Math.min(r.x.length - 1, Math.ceil(to / r.step));
		return { x: r.x.slice(a, b + 1), z: r.z.slice(a, b + 1) };
	};
	const drawn = [route, ...beside.map((s) => s.route)];
	beside.forEach((side, k) =>
		side.mouths.forEach((m, end) => {
			if (!m) return;
			const own = side.route;
			const [from, to] =
				end === 0 ? [0, JUNCTION_M] : [own.length - JUNCTION_M, own.length];
			// Every road drawn before it that passes the mouth, not only the one it ends on: at a node several roads meet in one place, and each gives way to those before it.
			m.near = [];
			for (let r = 0; r <= k; r++) {
				const other = drawn[r];
				let best = NODE_M;
				let at = -1;
				for (let i = 0; i < other.x.length; i++) {
					const d = Math.hypot(other.x[i] - m.x, other.z[i] - m.z);
					if (d < best) {
						best = d;
						at = i * other.step;
					}
				}
				if (r === m.met) at = m.at;
				if (at < 0) continue;
				m.near.push({ road: r, at });
				(own.meets ??= []).push({
					from,
					to,
					...slice(other, at - 2 * JUNCTION_M, at + 2 * JUNCTION_M),
					role: JOINS,
					// Seated on that road's carriageway, and not drawn on it or past its line: signed from the way it comes in.
					onto: carriagewayAt(other, liftOf(other, r === 0), at),
					near: [m.x - m.tx * APPROACH_M, m.z - m.tz * APPROACH_M],
				});
				// The road joined reads the side road's line only as far as its mouth: past it the ribbon runs on under the asphalt, and read there it would open the far shoulder too.
				const mine = slice(own, from, to);
				const cut = Math.ceil(m.over / own.step);
				const keep = (v: ArrayLike<number>) =>
					end === 0
						? Array.from(v).slice(cut)
						: Array.from(v).slice(0, v.length - cut);
				const x = keep(mine.x);
				const z = keep(mine.z);
				if (end === 0) {
					x.unshift(m.x);
					z.unshift(m.z);
				} else {
					x.push(m.x);
					z.push(m.z);
				}
				(r === 0 ? meets : (other.meets ??= [])).push({
					from: at - JUNCTION_M,
					to: at + JUNCTION_M,
					x,
					z,
					role: JOINED,
					// A junction's: the side road is seated on it, and their shoulders meet as one (crossings.ts SEATED_ON).
					near: [m.x - m.tx * APPROACH_M, m.z - m.tz * APPROACH_M],
				});
			}
		}),
	);
	// A roundabout: the road ridden runs on its ring and in on its arms, and is drawn on neither. Within reach of the ring its ribbon is hidden, and the ring and its straight arms (designed.ts armsOf) are drawn whole; further out its paint gives way to an arm's where the two overlap.
	let hidden: Float64Array | null = null;
	let flat: Float64Array | null = null;
	rings.forEach((_, j) => {
		const ring = beside[j].route;
		const n = ring.x.length - 1;
		let [cx, cz] = [0, 0];
		for (let k = 0; k < n; k++) {
			cx += ring.x[k] / n;
			cz += ring.z[k] / n;
		}
		const radius = Math.hypot(ring.x[0] - cx, ring.z[0] - cz);
		const arms = beside
			.slice(rings.length, kept.length)
			.map((s) => s.route)
			.filter((a) => Math.hypot(a.x[0] - cx, a.z[0] - cz) < radius + 1);
		// The arm reads the ring's line a shoulder's width in towards the island: drawn under the ring, it gives way to it to the ring's asphalt edge and no further, and lays its own shoulder over the ring's where the two meet. Read on the ring's own line it gave its shoulder up over the ring's whole formation, and the ground showed in the corner between them.
		const inner = (radius - SHOULDER) / radius;
		const towards = (v: ArrayLike<number>, c: number) =>
			Array.from(v, (p) => c + (p - c) * inner);
		for (const arm of arms) {
			(arm.meets ??= []).push({
				from: 0,
				to: arm.length,
				x: towards(ring.x, cx),
				z: towards(ring.z, cz),
				role: JOINS,
			});
			// The ring gives its shoulder and dashes its edge where the arm comes in, across the whole of its flared mouth: the arm's line, and one either side of it that follows its asphalt's edge a hand inside it. Further out, the ring's shoulder gave way where the arm had none, and the ground showed between the two.
			const [ux, uz] = [arm.x[1] - arm.x[0], arm.z[1] - arm.z[0]].map(
				(v) => v / arm.step,
			);
			for (const side of [0, -1, 1]) {
				const out = (k: number) =>
					side * mouthSide(arm.widen?.(k * arm.step) ?? 1);
				(ring.meets ??= []).push({
					from: 0,
					to: ring.length,
					x: arm.x.slice(0, MOUTH_ROWS).map((v, k) => v - uz * out(k)),
					z: arm.z.slice(0, MOUTH_ROWS).map((v, k) => v + ux * out(k)),
					role: JOINED,
				});
			}
		}
		const off = (i: number) => Math.hypot(route.x[i] - cx, route.z[i] - cz);
		const last = route.x.length - 1;
		const reach = radius + ARM_M + RING_REACH_M;
		for (let i = 0; i <= last; i++) {
			if (off(i) >= reach) continue;
			// One pass through the roundabout: its samples from here on that lie within reach of it.
			let end = i;
			while (end < last && off(end + 1) < reach) end++;
			// An arm's line is read 4 m short of its far end: the road is not drawn within its asphalt, and read to the very end that took a bite out of the road past the arm's square end.
			for (const other of [ring, ...arms]) {
				const cut = other === ring ? undefined : -2;
				meets.push({
					from: i * route.step,
					to: end * route.step,
					x: other.x.slice(0, cut),
					z: other.z.slice(0, cut),
					role: JOINS,
				});
			}
			for (let k = i; k <= end; k++) {
				if (off(k) < radius + ARM_M - RING_LAP_M)
					(hidden ??= new Float64Array(route.x.length))[k] = 1;
				// Level where it laps the arm, as the arm is: banked into its turn onto the ring, its high edge stood up to 0.2 m through the arm's asphalt.
				const levelled =
					1 - smoothstep(radius + ARM_M, radius + ARM_M + FLAT_EASE_M, off(k));
				if (levelled > 0) {
					const f = (flat ??= new Float64Array(route.x.length));
					f[k] = Math.max(f[k], levelled);
				}
			}
			i = end;
		}
	});
	const shown = hidden as Float64Array | null;
	const flattened = flat as Float64Array | null;
	if (shown && route.shared)
		for (let i = 0; i < shown.length; i++)
			shown[i] = Math.max(shown[i], route.shared[i]);
	const ridden: Route =
		meets.length > 0 || shown
			? {
					...route,
					meets,
					...(shown && { shared: shown }),
					...(flattened && { flat: flattened }),
				}
			: route;
	const made = makeGround(roads, { salt, scene: layout });
	// Nothing stands on a roundabout's island, nor on an arm where it flares wider than the road its line is: the ground knows a road by its line and one width.
	const rounds = roundaboutsOf(route.scene);
	const ground =
		rounds.length === 0
			? made
			: {
					...made,
					clearOf: (x: number, z: number, base: number) =>
						made.clearOf(x, z, base) && offRoundabouts(rounds, x, z, base),
				};
	// The scene as the ground laid it: its streams run where that ground falls.
	const scene = ground.scene;
	const margin = opts.margin ?? 1400;
	// The corridor's chunks are the diorama's alone: a ride never lists them.
	let cover: ReturnType<typeof corridor> | null = null;
	const chunks = () => (cover ??= corridor(ground.lines, margin)).chunks;
	// The place's levels, not the corridor's: a streamed chunk is the one the props stood on.
	// Fine along the streams, and along every shore: an island or a headland's tip drawn coarse stood out of its water.
	const level = placeLevel(
		ground.lines,
		(scene?.waters ?? [])
			.flatMap((w) => [w.outline, ...(w.islands ?? [])])
			.map((o) => ({ x: o.map((p) => p[0]), z: o.map((p) => p[1]) })),
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
		scene &&
			((x, z, reach) => scene.waterAt(x, z) !== null || roofedAt(x, z, reach)),
		scene && ((x, z, reach) => roofedAt(x, z, reach)),
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
	// Each gallery's back wall stands against the mountain, on the side the ground stands higher (scenery.ts roadworks): +1 left of travel, as a hit's side.
	const roofs = galleries.map(([a, b]) => {
		const i = Math.min(
			route.x.length - 2,
			Math.round((a + b) / 2 / route.step),
		);
		const sx = route.x[i + 1] - route.x[i];
		const sz = route.z[i + 1] - route.z[i];
		const len = Math.hypot(sx, sz) || 1;
		const out = FORMATION + 60;
		const over = (side: number) =>
			ground.heightAt(
				route.x[i] + (sz / len) * out * side,
				route.z[i] - (sx / len) * out * side,
			);
		return { a, b, back: over(1) >= over(-1) ? 1 : -1 };
	});
	// Each tunnel's line, from PORTAL.clear before one portal to as far past the other: what nothing stands near, and what a camera keeps under.
	const bores = [
		...tunnels.map((t) => ({ t, r: rows })),
		...sideTunnels.flatMap((ts, j) => ts.map((t) => ({ t, r: sideRows[j] }))),
	].map(({ t: [from, to], r }) => {
		const a = Math.max(0, Math.floor((from - PORTAL.clear) / ROW_M));
		const b = Math.min(r.length - 1, Math.ceil((to + PORTAL.clear) / ROW_M));
		const pts = r.slice(a, b + 1).map((p, k) => ({
			x: p.x,
			z: p.z,
			ele: p.ele,
			out: Math.max(0, from - (a + k) * ROW_M, (a + k) * ROW_M - to),
		}));
		return { pts, box: boxAround(pts) };
	});
	/** The nearest point of a tunnel's line within `reach` of (x, z): the road's height there and metres outside its portals. */
	const boreAt = (x: number, z: number, reach: number) => {
		let best: { ele: number; out: number; d: number } | null = null;
		for (const { pts, box } of bores) {
			if (
				x < box[0] - reach ||
				x > box[2] + reach ||
				z < box[1] - reach ||
				z > box[3] + reach
			)
				continue;
			for (let k = 0; k < pts.length - 1; k++) {
				const p = pts[k];
				const q = pts[k + 1];
				const sx = q.x - p.x;
				const sz = q.z - p.z;
				const t = Math.min(
					1,
					Math.max(
						0,
						((x - p.x) * sx + (z - p.z) * sz) / (sx * sx + sz * sz || 1),
					),
				);
				const d = Math.hypot(p.x + sx * t - x, p.z + sz * t - z);
				if (d < reach && (!best || d < best.d))
					best = {
						d,
						ele: p.ele + (q.ele - p.ele) * t,
						out: p.out + (q.out - p.out) * t,
					};
			}
		}
		return best;
	};
	const roofedAt = (x: number, z: number, reach = 0) => {
		// Nothing in a tunnel, over its portal or before it.
		if (bores.length > 0 && boreAt(x, z, PORTAL.half + reach + 0.5))
			return true;
		if (roofs.length === 0) return false;
		const hit = nearest(x, z);
		if (!hit || hit.d > GALLERY_EDGE + GALLERY_WALL + reach + GALLERY_CLEAR)
			return false;
		const d = (hit.i + hit.t) * route.step;
		return roofs.some(
			({ a, b, back }) =>
				d >= a - 4 - reach &&
				d <= b + 4 + reach &&
				// Behind the wall a thing keeps its own reach off it; on the open side off the pillars, so nothing pokes in under the roof.
				hit.d <
					GALLERY_EDGE +
						(hit.side === back ? GALLERY_WALL : 0) +
						reach +
						GALLERY_CLEAR,
		);
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
		ridden,
		offJunction: (m, x, z) =>
			Math.min(
				...(m.near ?? [{ road: m.met, at: m.at }]).map((n) =>
					offRoad(drawn[n.road], n.at, x, z),
				),
			),
		galleries,
		tunnels,
		roofedAt,
		roofAt(x, z) {
			if (bores.length > 0) {
				const b = boreAt(x, z, TUBE.half);
				if (b) {
					const floor = yOf(route, b.ele);
					return {
						floor: b.out > 0 ? null : floor,
						most: floor + TUBE.crown - UNDER_ROOF + 0.5 * b.out,
					};
				}
			}
			if (roofs.length === 0) return null;
			const hit = nearest(x, z);
			if (!hit || hit.d > GALLERY_EDGE) return null;
			const d = (hit.i + hit.t) * route.step;
			if (!roofs.some(({ a, b }) => d >= a && d <= b)) return null;
			const i = Math.min(route.ele.length - 1, Math.round(d / route.step));
			return {
				floor: null,
				most: yOf(route, route.ele[i]) + GALLERY.clear - UNDER_ROOF,
			};
		},
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

/**
 * Whether (x, z) keeps `base` metres off every roundabout's arm, as
 * ground.clearOf asks of a road, where the arm flares wider than one (its
 * line alone is the ground's); off every island, which its statue holds;
 * and off the signs before each arm.
 */
export function offRoundabouts(
	rounds: ReturnType<typeof roundaboutsOf>,
	x: number,
	z: number,
	base: number,
): boolean {
	for (const ring of rounds) {
		const dx = x - ring.x;
		const dz = z - ring.z;
		if (Math.hypot(dx, dz) < ring.r) return false;
		for (const arm of ring.arms) {
			const [ux, uz] = arm;
			// Nor on the signs before it: what keeps `base` off a road's line reaches that far past its formation.
			const sign = ringSignAt(ring, arm);
			if (
				Math.hypot(x - sign.x, z - sign.z) <
				Math.max(0, base - FORMATION) + SIGN_CLEAR_M
			)
				return false;
			const m = dx * ux + dz * uz - ring.r;
			if (m < 0 || m > ARM_M) continue;
			const across = Math.abs(dz * ux - dx * uz);
			if (across < base + FORMATION * (armWiden(m) - 1)) return false;
		}
	}
	return true;
}

/** Metres a roundabout's sign post keeps anything off it, past what that thing reaches. */
const SIGN_CLEAR_M = 0.6;

/** A gallery's roof reaches this far from the road's centre, where its back wall's face and its pillars stand (structure-sizes.ts GALLERY.out). */
const GALLERY_EDGE = FORMATION + GALLERY.out;
/** How far past that its back wall, its roof and the earth banked behind it reach into the hill (structures.ts galleries), and what a thing keeps clear of them or the pillars past its own reach. */
const GALLERY_WALL = GALLERY_BACK + GALLERY.ramp;
const GALLERY_CLEAR = 1;
/** Metres of each road, either side of a junction, whose paint reads the other road's line. */
const JUNCTION_M = 30;
/** Metres back from its mouth a point on a side road's own side of the road it meets lies. */
const APPROACH_M = 6;
/** A road passing within this of a mouth is part of its junction. */
const NODE_M = 20;
/** Metres out from a roundabout's edge within which the road ridden's paint reads the ring. */
const RING_REACH_M = 35;
/** Metres of an arm's far end the road ridden is drawn over, so the two lap. */
const RING_LAP_M = 12;
/**
 * Where the ring reads an arm's mouth either side of its line, metres off
 * it, where the arm is drawn `wide` times a road (designed.ts armWiden):
 * the ring gives its shoulder up within ROAD_W / 2 − 0.15 of such a line
 * (geometry.ts), so to a hand inside the arm's asphalt edge, never past it.
 */
const mouthSide = (wide: number) =>
	Math.max(0, (ROAD_W / 2) * wide - ROAD_W / 2 - 0.1);
/** The arm's rows, from the ring's centre line out, over which the ring reads its mouth: past its shoulder. */
const MOUTH_ROWS = 4;
/** Metres past an arm's end over which the road ridden eases from level back into its own bank. */
const FLAT_EASE_M = 30;
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

/** A spot names a road's metre within this of its line: a gallery's or a tunnel's on another of the map's roads is not this one's. */
const SPOT_M = 30;

/** The box round a line's points: minX, minZ, maxX, maxZ. */
function boxAround(pts: readonly { x: number; z: number }[]) {
	const b = [Infinity, Infinity, -Infinity, -Infinity];
	for (const p of pts) {
		b[0] = Math.min(b[0], p.x);
		b[1] = Math.min(b[1], p.z);
		b[2] = Math.max(b[2], p.x);
		b[3] = Math.max(b[3], p.z);
	}
	return b;
}

/**
 * The stretches between pairs of spots (designed.ts galleries, tunnels) on
 * a road's rows, in metres along it: each spot's nearest row within 30 m,
 * none where either spot lies off this road.
 */
export function spansAlong(
	rows: readonly { x: number; z: number }[],
	pairs: readonly (readonly [
		readonly [number, number],
		readonly [number, number],
	])[],
): [number, number][] {
	const metre = ([x, z]: readonly [number, number]) => {
		let best = SPOT_M;
		let at = -1;
		rows.forEach((p, i) => {
			const d = Math.hypot(p.x - x, p.z - z);
			if (d < best) {
				best = d;
				at = i * ROW_M;
			}
		});
		return at;
	};
	return pairs.flatMap(([a, b]) => {
		const [from, to] = [metre(a), metre(b)].sort((p, q) => p - q);
		return from < 0 ? [] : [[from, to] as [number, number]];
	});
}

/** A stream's bridge (a culvert's, where none carries the road already): its deck this far over the water at the least, and as long as the water is wide and this much more each side, past a road's formation and the fill's fall to the bank. */
const CULVERT = { over: 1, beyond: FORMATION + 2.5 };

/**
 * Where a stream runs under the road and the road is not carried over it
 * already: a short span over the water, in metres along the road, where
 * the road stands clear over it. The ground under it is left as the stream
 * cut it, so the water runs out from under the deck.
 */
export function culvertsOf(
	rows: readonly { x: number; z: number; ele: number }[],
	streams: readonly Water[],
): [number, number][] {
	const out: [number, number][] = [];
	for (const w of streams) {
		const run = w.run!;
		const n = run.levels.length;
		const o = w.outline;
		// Its centre line, and its width there: the outline is its left bank down and its right bank back.
		const mid = (i: number) => [
			(o[i][0] + o[o.length - 1 - i][0]) / 2,
			(o[i][1] + o[o.length - 1 - i][1]) / 2,
			Math.hypot(
				o[i][0] - o[o.length - 1 - i][0],
				o[i][1] - o[o.length - 1 - i][1],
			),
		];
		for (let i = 0; i < n - 1; i++) {
			const [ax, az, wide] = mid(i);
			const [bx, bz] = mid(i + 1);
			const ex = bx - ax;
			const ez = bz - az;
			for (let k = 0; k < rows.length - 1; k++) {
				const dx = rows[k + 1].x - rows[k].x;
				const dz = rows[k + 1].z - rows[k].z;
				const den = dx * ez - dz * ex;
				if (Math.abs(den) < 1e-9) continue;
				const rx = ax - rows[k].x;
				const rz = az - rows[k].z;
				const t = (rx * ez - rz * ex) / den;
				const u = (rx * dz - rz * dx) / den;
				if (t < 0 || t > 1 || u < 0 || u > 1) continue;
				const ele = rows[k].ele + (rows[k + 1].ele - rows[k].ele) * t;
				if (ele - run.levels[i] < CULVERT.over) continue;
				const m = (k + t) * ROW_M;
				// Square across the road or askew, the water's width along it.
				const cos =
					Math.abs(dx * ez - dz * ex) /
					(Math.hypot(dx, dz) * Math.hypot(ex, ez) || 1);
				const half = wide / 2 / Math.max(0.5, cos) + CULVERT.beyond;
				out.push([
					Math.max(0, m - half),
					Math.min((rows.length - 1) * ROW_M, m + half),
				]);
			}
		}
	}
	return out;
}

/** A road's bridges with its streams' culverts among them, overlapping ones one span: none in a tunnel, and no culvert under a gallery's roof either (`roofed`). */
export function withCulverts(
	bridges: readonly [number, number][],
	culverts: readonly [number, number][],
	tunnels: readonly [number, number][],
	roofed: readonly [number, number][] = [],
): [number, number][] {
	const all = [
		...bridges.filter(([a, b]) => !tunnels.some(([p, q]) => a < q && b > p)),
		...culverts.filter(
			([a, b]) =>
				![...tunnels, ...roofed].some(([p, q]) => a < q + 6 && b > p - 6),
		),
	]
		.map(([a, b]) => [a, b] as [number, number])
		.sort((p, q) => p[0] - q[0]);
	const out: [number, number][] = [];
	for (const s of all) {
		const last = out[out.length - 1];
		if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
		else out.push(s);
	}
	return out;
}

/** A gravel lane's apron: where it meets a road it is drawn as wide as one, narrowing to its own width over these metres from its mouth. */
const APRON = { full: 4, to: 18 };

/**
 * A gravel lane with an apron at each mouth (geometry.ts ribbonOf): a farm
 * track's paved mouth, as wide as a road's formation, so the road it joins
 * gives up its shoulder under it and the two are one surface.
 */
function apron(side: SideRoad): Route {
	const r = side.route;
	const flare = ROAD_W / GRAVEL_W - 1;
	const at = (m: number) =>
		1 + flare * (1 - smoothstep(APRON.full, APRON.to, m));
	const [a, b] = side.mouths;
	return {
		...r,
		widen: (d) => Math.max(a ? at(d) : 1, b ? at(r.length - d) : 1),
	};
}

/** Metres between a gravel lane's samples its heights are smoothed over, either way. */
const LANE_EASE = 5;
/** A lane over running water wider than a sample stands this far over it, on a bridge. */
const LANE_OVER_M = 5;

/**
 * A gravel lane's heights (designed.ts Lane): the ground's under it as the
 * map's other roads shape it, smoothed, so a farm track lies on its field
 * and a forest road on its hillside. Over a river it is lifted onto a
 * bridge, eased up to it and down from it.
 */
function drape(
	route: Route,
	others: Route[],
	salt: Salt,
	scene: NonNullable<ReturnType<typeof sceneOf>>,
) {
	const lanes = others.filter((o) => o.gravel);
	if (lanes.length === 0) return;
	const lineOf = (r: Route, key: string): Line => ({
		key,
		x: r.x,
		z: r.z,
		h: r.ele,
	});
	const ground = makeGround(
		[
			lineOf(route, 'route'),
			...others.flatMap((o, k) => (o.gravel ? [] : [lineOf(o, `o:${k}`)])),
		],
		{ salt, scene },
	);
	const water = ground.scene ?? scene;
	for (const lane of lanes) {
		const n = lane.x.length;
		const raw = Array.from(lane.x, (x, i) => ground.heightAt(x, lane.z[i]));
		const ele = raw.map((_, i) => {
			let sum = 0;
			let count = 0;
			for (
				let k = Math.max(0, i - LANE_EASE);
				k <= Math.min(n - 1, i + LANE_EASE);
				k++
			) {
				sum += raw[k];
				count++;
			}
			return sum / count;
		});
		// Over a river: a run of wet samples, lifted onto a deck and eased to it.
		const wet = Array.from(lane.x, (x, i) => water.waterAt(x, lane.z[i]));
		for (let i = 0; i < n; i++) {
			if (wet[i] === null) continue;
			let j = i;
			while (j + 1 < n && wet[j + 1] !== null) j++;
			if (j > i) {
				const deck =
					Math.max(...wet.slice(i, j + 1).map((w) => w!)) + LANE_OVER_M;
				for (
					let k = Math.max(0, i - 2 * LANE_EASE);
					k <= Math.min(n - 1, j + 2 * LANE_EASE);
					k++
				) {
					const t =
						k < i
							? 1 - (i - k) / (2 * LANE_EASE)
							: k > j
								? 1 - (k - j) / (2 * LANE_EASE)
								: 1;
					const w = t * t * (3 - 2 * t);
					ele[k] = Math.max(ele[k], ele[k] + (deck - ele[k]) * w);
				}
			}
			i = j;
		}
		lane.ele.set(ele);
		for (let i = 1; i < n; i++)
			lane.grade[i] = ((ele[i] - ele[i - 1]) / lane.step) * 100;
	}
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
