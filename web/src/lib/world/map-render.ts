/**
 * A land's map as one picture (map-render.golden.test.ts writes it): the
 * whole of its bounds (designs.ts LANDS) drawn once from the world its
 * `drawnFrom` loop builds, the land in flat areas of the colours the 3D
 * world paints it, as a game's island map is drawn, and the water over it. What a page draws live over the
 * picture (the roads, the names, where you are) is worked out here too, as
 * data, in the world's frame: x east, z south (−north). Node and browser
 * alike: no I/O here, the test writes the files.
 */
import { at } from '#lib/road/along.ts';
import type { Route } from '#lib/road/route.ts';
import { Biome } from './biome';
import { designedLine, roundaboutsOf, sceneOf } from './designed';
import { DESIGNS, type Bounds, type Land } from './designs';
import { CHUNK_M, FINE_M } from './place/lattice';
import { villageSites } from './props/scatter';
import { makeGround } from './terrain/ground';
import type { World } from './world';

/** Metres between the ground's vertices the picture is drawn from: the fine ground, so an edge of snow or rock is no 40 m staircase. */
const GROUND_M = FINE_M;

export type MapData = {
	name: string;
	bounds: Bounds;
	/** The picture: its pixels and the metres each covers. */
	image: { w: number; h: number; mpp: number };
	/** Every loop id the picture's roads are. */
	loops: string[];
	/** SVG path data in the world's frame, metres. */
	roads: {
		loops: string;
		spurs: string;
		/** The gravel lanes: drawn finer than a road, dashed. */
		lanes?: string;
		bridges: string;
		galleries: string;
		/** Where a loop runs through a tunnel: its road dashed over the hill. */
		tunnels?: string;
	};
	labels: Label[];
	/** Each roundabout's centre: the page draws a ring there as a map's symbol, bigger than the 18 m ring itself. */
	rings: { x: number; z: number }[];
	/** The font sizes, in the map's metres, the names were placed for. */
	type: { village: number; pass: number };
	/** How big the page draws its names, marks and scale bar against Wattalp's (Land.scale): 1 where not given. */
	scale?: number;
};

export type Label = {
	kind: 'village' | 'pass';
	name: string;
	/** The place itself. */
	x: number;
	z: number;
	/** Where its name is written, and how it is anchored there. */
	tx: number;
	tz: number;
	anchor: 'start' | 'middle' | 'end';
};

const hex = (s: string): [number, number, number] => {
	const v = parseInt(s.slice(1), 16);
	return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

/** The world's colours by token name without the dashes (`world-px-biome-meadow`), from app.css's text. */
export function tokensOf(
	css: string,
): Record<string, [number, number, number]> {
	const out: Record<string, [number, number, number]> = {};
	for (const m of css.matchAll(/--(world-[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi))
		out[m[1]] ??= hex(m[2]);
	return out;
}

const lerp3 = (a: number[], b: number[], t: number) =>
	[0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * t);

/** Even-odd coverage of a ring over the picture, `ss`² samples a pixel: 0..1 per pixel added into `into`. */
function fillRing(
	into: Float32Array,
	w: number,
	h: number,
	ring: readonly (readonly [number, number])[],
	toPx: (x: number, z: number) => [number, number],
	ss = 4,
) {
	const pts = ring.map(([x, z]) => toPx(x, z));
	const add = 1 / (ss * ss);
	const cover = new Float32Array(w * h);
	for (let sy = 0; sy < h * ss; sy++) {
		const y = (sy + 0.5) / ss;
		const xs: number[] = [];
		for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
			const [x0, y0] = pts[j];
			const [x1, y1] = pts[i];
			if (y0 <= y === y1 <= y) continue;
			xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
		}
		xs.sort((a, b) => a - b);
		const row = Math.floor(y) * w;
		for (let k = 0; k + 1 < xs.length; k += 2) {
			const a = Math.max(0, Math.ceil(xs[k] * ss - 0.5));
			const b = Math.min(w * ss - 1, Math.floor(xs[k + 1] * ss - 0.5));
			for (let sx = a; sx <= b; sx++) cover[row + Math.floor(sx / ss)] += add;
		}
	}
	for (let i = 0; i < into.length; i++)
		into[i] = Math.max(into[i], Math.min(1, cover[i]));
}

/** A line `width` pixels wide over the picture, anti-aliased: its coverage added into `into`. */
function strokeLine(
	into: Float32Array,
	w: number,
	h: number,
	pts: readonly (readonly [number, number])[],
	width: number,
) {
	const r = width / 2;
	for (let i = 0; i + 1 < pts.length; i++) {
		const [ax, ay] = pts[i];
		const [bx, by] = pts[i + 1];
		const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1));
		const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r + 1));
		const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 1));
		const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r + 1));
		const dx = bx - ax;
		const dy = by - ay;
		const len2 = dx * dx + dy * dy || 1;
		for (let y = y0; y <= y1; y++)
			for (let x = x0; x <= x1; x++) {
				const px = x + 0.5 - ax;
				const py = y + 0.5 - ay;
				const t = Math.min(1, Math.max(0, (px * dx + py * dy) / len2));
				const d = Math.hypot(px - t * dx, py - t * dy);
				const c = Math.min(1, Math.max(0, r + 0.5 - d));
				const k = y * w + x;
				if (c > into[k]) into[k] = c;
			}
	}
}

/**
 * The land under the map, pixel by pixel, as RGB, drawn as a game's island
 * map is (Zwift's Watopia): flat areas of colour with soft, rounded edges,
 * not a photograph. Each 10 m vertex of the fine ground takes its cover
 * (meadow, forest, rock, snow, moor, dry ground), each cover is softened over
 * 100 m and the strongest one paints the pixel in its flat world colour; the
 * relief is three steps of the same colour, the slopes turned from the
 * north-western sun a shade darker and those facing it a shade lighter, so
 * the hills and the col still read. The water flat blue, two lighter bands
 * of shallows along its shore.
 */
export function renderLand(
	world: World,
	colours: Record<string, [number, number, number]>,
	land: Land,
): { rgb: Uint8Array; w: number; h: number } {
	const { west, east, south, north } = land.bounds;
	const mpp = land.mpp;
	const w = Math.round((east - west) / mpp);
	const h = Math.round((north - south) / mpp);
	const c = (t: string) => colours[`world-px-${t}`];
	// The covers the map paints, each a flat colour.
	const COVERS = [
		c('biome-meadow'),
		c('biome-forest'),
		c('biome-alpine'),
		c('biome-rock'),
		c('biome-snow'),
		c('biome-moor'),
		c('biome-dry'),
	];
	const coverOf = (b: number, forest: number) =>
		b === Biome.Forest || (b === Biome.Meadow && forest > 0.5)
			? 1
			: b === Biome.Alpine
				? 2
				: b === Biome.Rock
					? 3
					: b === Biome.Snow || b === Biome.Frost
						? 4
						: b === Biome.Moor
							? 5
							: b === Biome.Dry
								? 6
								: 0;

	// The fine ground's vertices over the whole rectangle, a chunk at a time.
	const z0 = -north;
	const ci0 = Math.floor(west / CHUNK_M);
	const ci1 = Math.floor(east / CHUNK_M);
	const cj0 = Math.floor(z0 / CHUNK_M);
	const cj1 = Math.floor(-south / CHUNK_M);
	const per = CHUNK_M / GROUND_M;
	const gw = (ci1 - ci0 + 1) * per + 1;
	const gh = (cj1 - cj0 + 1) * per + 1;
	const gx0 = ci0 * CHUNK_M;
	const gz0 = cj0 * CHUNK_M;
	const H = new Float32Array(gw * gh);
	const W = COVERS.map(() => new Float32Array(gw * gh));
	const edges = [GROUND_M, GROUND_M, GROUND_M, GROUND_M] as const;
	for (let cj = cj0; cj <= cj1; cj++)
		for (let ci = ci0; ci <= ci1; ci++) {
			const g = world.gridAt(ci, cj, 'fine', edges);
			for (let j = 0; j < g.row; j++)
				for (let i = 0; i < g.row; i++) {
					const v = j * g.row + i;
					const k = ((cj - cj0) * per + j) * gw + (ci - ci0) * per + i;
					H[k] = g.h[v];
					for (const A of W) A[k] = 0;
					W[coverOf(g.biome[v], g.forest[v])][k] = 1;
				}
		}
	// Each cover softened over 100 m: a patch is an area with a rounded edge, not a speckle.
	for (const A of W) blur(A, gw, gh, 5);

	// The relief per vertex: how squarely a slope faces the sun in the north-west, 1 on the flat.
	const alt = (45 * Math.PI) / 180;
	const az = (315 * Math.PI) / 180;
	// x east, z south: the sun's azimuth clockwise from north.
	const L = [
		Math.cos(alt) * Math.sin(az),
		Math.sin(alt),
		-Math.cos(alt) * Math.cos(az),
	];
	const SHADE = new Float32Array(gw * gh);
	for (let j = 0; j < gh; j++)
		for (let i = 0; i < gw; i++) {
			const hx =
				(H[j * gw + Math.min(gw - 1, i + 2)] - H[j * gw + Math.max(0, i - 2)]) /
				(4 * GROUND_M);
			const hz =
				(H[Math.min(gh - 1, j + 2) * gw + i] - H[Math.max(0, j - 2) * gw + i]) /
				(4 * GROUND_M);
			const nx = -hx * 2;
			const nz = -hz * 2;
			const len = Math.hypot(nx, 1, nz);
			SHADE[j * gw + i] =
				Math.max(0, nx * L[0] + L[1] + nz * L[2]) / len / L[1];
		}
	blur(SHADE, gw, gh, 1);

	const field = (A: Float32Array, fx: number, fz: number) => {
		const i = Math.min(gw - 2, Math.max(0, Math.floor(fx)));
		const j = Math.min(gh - 2, Math.max(0, Math.floor(fz)));
		const tx = fx - i;
		const tz = fz - j;
		const a = A[j * gw + i];
		const b = A[j * gw + i + 1];
		const cc = A[(j + 1) * gw + i];
		const d = A[(j + 1) * gw + i + 1];
		return (a * (1 - tx) + b * tx) * (1 - tz) + (cc * (1 - tx) + d * tx) * tz;
	};

	const toPx = (x: number, z: number): [number, number] => [
		(x - west) / mpp,
		(z - z0) / mpp,
	];
	// The water: lakes and rivers filled, streams a line at least 1.6 px wide.
	const wet = new Float32Array(w * h);
	const flowing = new Float32Array(w * h);
	const isles = new Float32Array(w * h);
	for (const water of world.waters) {
		if (!water.run) {
			fillRing(wet, w, h, water.outline, toPx);
			for (const isle of water.islands ?? []) fillRing(isles, w, h, isle, toPx);
			continue;
		}
		const o = water.outline;
		const n = o.length;
		const mid: [number, number][] = [];
		let wide = 0;
		for (let i = 0; i < n >> 1; i++) {
			const [ax, az] = o[i];
			const [bx, bz] = o[n - 1 - i];
			mid.push(toPx((ax + bx) / 2, (az + bz) / 2));
			wide = Math.max(wide, Math.hypot(ax - bx, az - bz));
		}
		strokeLine(flowing, w, h, mid, Math.max(1.6, wide / mpp));
	}
	// An island is land.
	for (let k = 0; k < wet.length; k++) wet[k] = Math.max(0, wet[k] - isles[k]);
	// How far each pixel of a lake or river lies from its shore, in pixels: the shallows are drawn by it, 40 m and 100 m out.
	const shoreDist = chamfer(wet, w, h);

	const water = c('biome-water');
	const shallow = lerp3(
		lerp3(water, c('biome-meadow'), 0.4),
		c('sky-light'),
		0.3,
	);
	const shoal = lerp3(water, c('biome-meadow'), 0.22);
	const step = (a: number, b: number, v: number) =>
		Math.min(1, Math.max(0, (v - a) / (b - a)));
	const rgb = new Uint8Array(w * h * 3);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const k = y * w + x;
			const fx = (west + (x + 0.5) * mpp - gx0) / GROUND_M;
			const fz = (z0 + (y + 0.5) * mpp - gz0) / GROUND_M;
			// The strongest cover, its edge with the next one a pixel soft.
			let first = 0;
			let second = 0;
			let a = -1;
			let b = -1;
			for (let i = 0; i < W.length; i++) {
				const v = field(W[i], fx, fz);
				if (v > a) {
					[second, b] = [first, a];
					[first, a] = [i, v];
				} else if (v > b) [second, b] = [i, v];
			}
			let col = lerp3(
				COVERS[second],
				COVERS[first],
				0.5 + Math.min(0.5, (a - b) * 6),
			);
			// Three steps of light, each a pixel soft at its edge.
			const lit = field(SHADE, fx, fz);
			const dark = 1 - step(0.8, 0.86, lit);
			const light = step(1.12, 1.18, lit);
			col = col.map((v) => v * (1 - 0.13 * dark + 0.1 * light));

			const sheet = wet[k];
			if (sheet > 0) {
				const s = shoreDist[k];
				const body = lerp3(
					lerp3(water, shoal, 1 - step(100 / mpp, 110 / mpp, s)),
					shallow,
					1 - step(40 / mpp, 50 / mpp, s),
				);
				col = lerp3(col, body, sheet);
			}
			if (flowing[k] > sheet) col = lerp3(col, shallow, flowing[k]);

			rgb[k * 3] = Math.round(Math.min(255, Math.max(0, col[0])));
			rgb[k * 3 + 1] = Math.round(Math.min(255, Math.max(0, col[1])));
			rgb[k * 3 + 2] = Math.round(Math.min(255, Math.max(0, col[2])));
		}
	return { rgb, w, h };
}

/** A box blur of `r` vertices each way over a grid, in place: twice, so it falls off like a bell. */
function blur(A: Float32Array, gw: number, gh: number, r: number) {
	const tmp = new Float32Array(A.length);
	for (let pass = 0; pass < 2; pass++) {
		for (let j = 0; j < gh; j++)
			for (let i = 0; i < gw; i++) {
				let s = 0;
				let n = 0;
				for (let k = Math.max(0, i - r); k <= Math.min(gw - 1, i + r); k++) {
					s += A[j * gw + k];
					n++;
				}
				tmp[j * gw + i] = s / n;
			}
		for (let j = 0; j < gh; j++)
			for (let i = 0; i < gw; i++) {
				let s = 0;
				let n = 0;
				for (let k = Math.max(0, j - r); k <= Math.min(gh - 1, j + r); k++) {
					s += tmp[k * gw + i];
					n++;
				}
				A[j * gw + i] = s / n;
			}
	}
}

/** Each pixel's distance to the nearest pixel outside `cover` (under half covered), in pixels, by a two-pass chamfer: 0 outside. */
function chamfer(cover: Float32Array, w: number, h: number): Float32Array {
	const D = new Float32Array(w * h);
	const far = 1e6;
	for (let k = 0; k < D.length; k++) D[k] = cover[k] >= 0.5 ? far : 0;
	const S = Math.SQRT2;
	const at = (x: number, y: number) =>
		x < 0 || y < 0 || x >= w || y >= h ? far : D[y * w + x];
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const k = y * w + x;
			if (D[k] === 0) continue;
			D[k] = Math.min(
				D[k],
				at(x - 1, y) + 1,
				at(x, y - 1) + 1,
				at(x - 1, y - 1) + S,
				at(x + 1, y - 1) + S,
			);
		}
	for (let y = h - 1; y >= 0; y--)
		for (let x = w - 1; x >= 0; x--) {
			const k = y * w + x;
			if (D[k] === 0) continue;
			D[k] = Math.min(
				D[k],
				at(x + 1, y) + 1,
				at(x, y + 1) + 1,
				at(x + 1, y + 1) + S,
				at(x - 1, y + 1) + S,
			);
		}
	// A pixel at the edge of the water is half a pixel from the shore.
	for (let k = 0; k < D.length; k++) if (D[k] > 0) D[k] -= 0.5;
	return D;
}

/** Douglas–Peucker, `tol` metres: a line's points that its shape needs. */
function simplify(pts: [number, number][], tol: number): [number, number][] {
	if (pts.length < 3) return pts;
	const keep = new Uint8Array(pts.length);
	keep[0] = keep[pts.length - 1] = 1;
	const stack: [number, number][] = [[0, pts.length - 1]];
	while (stack.length) {
		const [a, b] = stack.pop()!;
		const [ax, az] = pts[a];
		const [bx, bz] = pts[b];
		const dx = bx - ax;
		const dz = bz - az;
		const len = Math.hypot(dx, dz);
		let worst = -1;
		let at = -1;
		for (let i = a + 1; i < b; i++) {
			// A closed line's two ends are one point: its others' distance is to that point.
			const d =
				len < 1e-6
					? Math.hypot(pts[i][0] - ax, pts[i][1] - az)
					: Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / len;
			if (d > worst) [worst, at] = [d, i];
		}
		if (worst > tol) {
			keep[at] = 1;
			stack.push([a, at], [at, b]);
		}
	}
	return pts.filter((_, i) => keep[i]);
}

const pointsOf = (r: Route, from = 0, to = r.length, step = 4) => {
	const out: [number, number][] = [];
	for (let d = from; d < to; d += step) {
		const p = at(r, d);
		out.push([p.x, p.z]);
	}
	const p = at(r, to);
	out.push([p.x, p.z]);
	return out;
};
const pathOf = (lines: [number, number][][], close = false) =>
	lines
		.map(
			(l) =>
				`M${simplify(l, 1.5)
					.map(([x, z]) => `${Math.round(x)} ${Math.round(z)}`)
					.join('L')}${close ? 'Z' : ''}`,
		)
		.join('');

/** Rough width of a name in metres at `size` metres a letter, in capitals spaced as LandMap.svelte writes them: for keeping two names apart. */
const widthOf = (name: string, size: number) => name.length * size * 0.8;

/** Font sizes in Wattalp's metres, as LandMap.svelte draws them: a land's are these times its scale. */
export const MAP_TYPE = { village: 180, pass: 190 } as const;

/**
 * What the page draws over a land's picture: the roads, the names and where
 * each is written, so no two overlap. `world` is the land's `drawnFrom`
 * loop's: its other roads are every road on the map.
 */
export function mapData(world: World, route: Route, land: Land): MapData {
	const { west, east, south, north } = land.bounds;
	const loops = land.loops.map((id) =>
		designedLine(DESIGNS.find((d) => d.id === id)!),
	);
	const type =
		land.scale === 1
			? MAP_TYPE
			: {
					village: Math.round(MAP_TYPE.village * land.scale),
					pass: Math.round(MAP_TYPE.pass * land.scale),
				};
	const spurs = world.sides.filter(
		(s) => s.route.name === 'spur' && !s.route.gravel,
	);
	const lanes = world.sides.filter((s) => s.route.gravel);
	const bridges: [number, number][][] = [];
	for (const [from, to] of world.bridges)
		bridges.push(pointsOf(route, from, to));
	for (const s of world.sides)
		for (const [from, to] of s.bridges)
			bridges.push(pointsOf(s.route, from, to));
	const scene = sceneOf(route.scene)!;
	const onLoops = ([a, b]: (typeof scene.galleries)[number]) => {
		for (const l of loops) {
			const ia = nearestOn(l, a[0], a[1]);
			const ib = nearestOn(l, b[0], b[1]);
			if (ia.d < 30 && ib.d < 30) {
				const [p, q] = [ia.m, ib.m].sort((u, v) => u - v);
				return [pointsOf(l, p, q)];
			}
		}
		return [];
	};
	const galleries = scene.galleries.flatMap(onLoops);
	const tunnels = scene.tunnels.flatMap(onLoops);
	const labels = placeLabels(
		world,
		route,
		loops,
		[...spurs, ...lanes].map((s) => s.route),
		land,
		type,
	);
	return {
		name: land.name,
		bounds: land.bounds,
		image: {
			w: Math.round((east - west) / land.mpp),
			h: Math.round((north - south) / land.mpp),
			mpp: land.mpp,
		},
		loops: [...land.loops],
		roads: {
			loops: pathOf(
				loops.map((l) => pointsOf(l, 0, l.length, 6)),
				true,
			),
			spurs: pathOf(spurs.map((s) => pointsOf(s.route, 0, s.route.length, 6))),
			lanes: pathOf(lanes.map((s) => pointsOf(s.route, 0, s.route.length, 6))),
			bridges: pathOf(bridges),
			galleries: pathOf(galleries),
			tunnels: pathOf(tunnels),
		},
		labels,
		rings: roundaboutsOf(route.scene).map((r) => ({
			x: Math.round(r.x),
			z: Math.round(r.z),
		})),
		type,
		...(land.scale !== 1 && { scale: land.scale }),
	};
}

function nearestOn(r: Route, x: number, z: number) {
	let best = { d: Infinity, m: 0 };
	for (let i = 0; i < r.x.length; i++) {
		const d = Math.hypot(r.x[i] - x, r.z[i] - z);
		if (d < best.d) best = { d, m: i * r.step };
	}
	return best;
}

type Box = [x0: number, z0: number, x1: number, z1: number];
const hits = (a: Box, b: Box) =>
	a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** Every name on the map, each written where it overlaps no other and stays inside the picture. */
function placeLabels(
	world: World,
	route: Route,
	loops: Route[],
	spurs: Route[],
	land: Land,
	type: MapData['type'],
): Label[] {
	// Every road every 40 m: a name is written beside a road, not over it.
	const roadPts = [...loops, ...spurs].flatMap((r) =>
		pointsOf(r, 0, r.length, 40),
	);
	const { west, east, south, north } = land.bounds;
	// The page's marks are drawn this many times Wattalp's size, and kept clear of at that size.
	const k = land.scale;
	const taken: Box[] = [];
	// The map's name's corner (Wattalp's seven letters 2,900 m wide), the north arrow's and the scale bar's: no name there.
	const named = 2900 + 380 * (land.name.length - 7);
	taken.push([west, -north, west + named * k, -north + 900 * k]);
	taken.push([east - 800 * k, -north, east, -north + 1150 * k]);
	taken.push([west, -south - 700 * k, west + 2700 * k, -south]);
	// And none over a roundabout's ring.
	for (const r of roundaboutsOf(route.scene))
		taken.push([r.x - 130 * k, r.z - 130 * k, r.x + 130 * k, r.z + 130 * k]);
	// Nor over the start's flag, planted north of each loop's start (LandMap.svelte).
	for (const l of loops) {
		const p = at(l, 0);
		taken.push([p.x - 60 * k, p.z - 490 * k, p.x + 280 * k, p.z + 60 * k]);
	}
	const inside = (b: Box) =>
		b[0] > west + 80 * k &&
		b[2] < east - 80 * k &&
		b[1] > -north + 80 * k &&
		b[3] < -south - 80 * k;
	const out: Label[] = [];
	const place = (
		base: Omit<Label, 'tx' | 'tz' | 'anchor'>,
		size: number,
		gap: number,
	) => {
		const wide = widthOf(base.name, size);
		const tall = size * 1.05;
		const pad = 20 * k;
		const tries: [number, number, Label['anchor']][] = [
			[base.x + gap, base.z + size * 0.35, 'start'],
			[base.x - gap, base.z + size * 0.35, 'end'],
			[base.x, base.z - gap, 'middle'],
			[base.x, base.z + gap + size * 0.8, 'middle'],
			[base.x + gap * 0.8, base.z - gap * 0.9, 'start'],
			[base.x + gap * 0.8, base.z + gap + size * 0.6, 'start'],
			[base.x - gap * 0.8, base.z - gap * 0.9, 'end'],
			[base.x - gap * 0.8, base.z + gap + size * 0.6, 'end'],
		];
		const boxOf = ([tx, tz, a]: (typeof tries)[number]): Box => {
			const x0 = a === 'start' ? tx : a === 'end' ? tx - wide : tx - wide / 2;
			return [
				x0 - pad,
				tz - size * 0.85,
				x0 + wide + pad,
				tz - size * 0.85 + tall + pad / 2,
			];
		};
		const mark: Box = [
			base.x - gap * 0.6,
			base.z - gap * 0.6,
			base.x + gap * 0.6,
			base.z + gap * 0.6,
		];
		// Of the spots clear of every other name, the one over the least road.
		const over = (b: Box) =>
			roadPts.reduce(
				(n, [x, z]) =>
					n + (x > b[0] && x < b[2] && z > b[1] && z < b[3] ? 1 : 0),
				0,
			);
		const free = tries.filter(
			(t) => inside(boxOf(t)) && !taken.some((b) => hits(b, boxOf(t))),
		);
		const pick =
			free.length > 0
				? free.reduce((a, b) => (over(boxOf(b)) < over(boxOf(a)) ? b : a))
				: (tries.find((t) => inside(boxOf(t))) ?? tries[0]);
		taken.push(boxOf(pick), mark);
		out.push({
			...base,
			tx: Math.round(pick[0]),
			tz: Math.round(pick[1]),
			anchor: pick[2],
		});
	};

	// The passes, at their road's highest point near where the scene names them.
	const passes = (sceneOf(route.scene)?.names.passes ?? []).map((p) => {
		let top = { x: p.x, z: p.z, ele: world.groundAt(p.x, p.z) };
		let best = Infinity;
		for (const l of loops)
			for (let i = 0; i < l.x.length; i++) {
				const d = Math.hypot(l.x[i] - p.x, l.z[i] - p.z);
				if (d < 250 && (best > 250 || l.ele[i] > top.ele || d < best)) {
					if (d < best || l.ele[i] > top.ele)
						top = { x: l.x[i], z: l.z[i], ele: l.ele[i] };
					best = Math.min(best, d);
				}
			}
		return { name: p.name, ...top };
	});
	// Marks first: no name over a marker.
	for (const p of passes)
		taken.push([p.x - 100 * k, p.z - 110 * k, p.x + 100 * k, p.z + 80 * k]);
	for (const p of passes)
		place(
			{
				kind: 'pass',
				name: p.name,
				x: Math.round(p.x),
				z: Math.round(p.z),
			},
			type.pass,
			130 * k,
		);

	for (const v of villagesOf(world, route, land.bounds))
		place(
			{ kind: 'village', name: v.name, x: Math.round(v.x), z: Math.round(v.z) },
			type.village,
			110 * k,
		);

	return out;
}

/** The villages where they stand: the sites the world's props are built round, each by its name. */
function villagesOf(world: World, route: Route, bounds: Bounds) {
	const ground = makeGround(world.roads, {
		salt: world.salt,
		scene: sceneOf(route.scene),
	});
	const sites = villageSites({
		salt: world.salt,
		ground,
		heightAt: world.heightAt,
		biomeAt: world.biomeAt,
	});
	const { west, east, south, north } = bounds;
	return sites.filter(
		(v) => v.x > west && v.x < east && v.z > -north && v.z < -south,
	);
}
