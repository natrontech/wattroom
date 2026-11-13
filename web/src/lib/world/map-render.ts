/**
 * The map as one picture (map-render.golden.test.ts writes it): the whole
 * of MAP_BOUNDS drawn once from the world the Col de Berne loop builds, the
 * land in the colours the 3D world paints it, lit from the north-west so the
 * mountains stand up, and the water over it. What a page draws live over the
 * picture (the roads, the names, where you are) is worked out here too, as
 * data, in the world's frame: x east, z south (−north). Node and browser
 * alike: no I/O here, the test writes the files.
 */
import { at } from '#lib/road/along.ts';
import type { Route } from '#lib/road/route.ts';
import { Biome } from './biome';
import { designedLine, sceneOf } from './designed';
import { DESIGNS, MAP_BOUNDS, MAP_NAME } from './designs';
import { CHUNK_M, FINE_M } from './place/lattice';
import { villageSites } from './props/scatter';
import { makeGround } from './terrain/ground';
import type { World } from './world';

/** Metres a pixel of the picture covers. */
export const MAP_MPP = 10;
/** Metres between the ground's vertices the picture is drawn from: the fine ground, so an edge of snow or rock is no 40 m staircase. */
const GROUND_M = FINE_M;
/** The loops drawn as the map's main roads, by design id. */
export const MAP_LOOPS = DESIGNS.filter((d) => d.others).map((d) => d.id);

/** The map's water by name: designs.ts names none, a map does. Each at the spot its name is written. */
const WATER_NAMES: {
	name: string;
	at: [east: number, north: number];
	river?: boolean;
}[] = [
	{ name: 'Urnsee', at: [-50, 2500] },
	{ name: 'Aaren', at: [1680, -3100], river: true },
];

export type MapData = {
	name: string;
	bounds: typeof MAP_BOUNDS;
	/** The picture: its pixels and the metres each covers. */
	image: { w: number; h: number; mpp: number };
	/** Every loop id the picture's roads are. */
	loops: string[];
	/** SVG path data in the world's frame, metres. */
	roads: { loops: string; spurs: string; bridges: string; galleries: string };
	labels: Label[];
};

export type Label = {
	kind: 'village' | 'pass' | 'water' | 'river';
	name: string;
	/** The place itself. */
	x: number;
	z: number;
	/** Where its name is written, and how it is anchored there. */
	tx: number;
	tz: number;
	anchor: 'start' | 'middle' | 'end';
	/** A pass's height, metres. */
	ele?: number;
	/** Degrees the name is turned by, a river's along it. */
	angle?: number;
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
const smooth = (a: number, b: number, v: number) => {
	const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
	return t * t * (3 - 2 * t);
};

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
 * The land under the map, pixel by pixel, as RGB: each 40 m vertex of the
 * coarse ground coloured as geometry.ts's terrain() colours it, blended
 * between vertices as the GPU blends them, lit by a low north-western sun;
 * the lakes, the river and the streams over it; a soft dark rim round it.
 */
export function renderLand(
	world: World,
	colours: Record<string, [number, number, number]>,
): { rgb: Uint8Array; w: number; h: number } {
	const { west, east, south, north } = MAP_BOUNDS;
	const w = Math.round((east - west) / MAP_MPP);
	const h = Math.round((north - south) / MAP_MPP);
	const c = (t: string) => colours[`world-px-${t}`];
	const palette: Record<number, number[]> = {
		[Biome.Meadow]: c('biome-meadow'),
		[Biome.Forest]: c('biome-forest'),
		[Biome.Alpine]: c('biome-alpine'),
		[Biome.Rock]: c('biome-rock'),
		[Biome.Snow]: c('biome-snow'),
		[Biome.Frost]: c('biome-snow'),
		[Biome.Verge]: c('biome-verge'),
		[Biome.Moor]: c('biome-moor'),
		[Biome.Dry]: c('biome-dry'),
		// Under the water's sheet: the bank the sheet's edge is drawn over.
		[Biome.Water]: lerp3(c('biome-meadow'), c('biome-dry'), 0.5),
	};

	// The coarse ground's vertices over the whole rectangle, a chunk at a time.
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
	const R = new Float32Array(gw * gh);
	const G = new Float32Array(gw * gh);
	const B = new Float32Array(gw * gh);
	const AO = new Float32Array(gw * gh);
	const edges = [GROUND_M, GROUND_M, GROUND_M, GROUND_M] as const;
	for (let cj = cj0; cj <= cj1; cj++)
		for (let ci = ci0; ci <= ci1; ci++) {
			const g = world.gridAt(ci, cj, 'fine', edges);
			for (let j = 0; j < g.row; j++)
				for (let i = 0; i < g.row; i++) {
					const v = j * g.row + i;
					const k = ((cj - cj0) * per + j) * gw + (ci - ci0) * per + i;
					const b = g.biome[v];
					const col =
						b === Biome.Meadow || b === Biome.Forest
							? lerp3(palette[Biome.Meadow], palette[Biome.Forest], g.forest[v])
							: (palette[b] ?? palette[Biome.Meadow]);
					H[k] = g.h[v];
					R[k] = col[0];
					G[k] = col[1];
					B[k] = col[2];
					AO[k] = Math.min(1, Math.max(0, (g.shade[v] - 0.72) / 0.4));
				}
		}

	// Hillshade per vertex: the sun 40° up in the north-west, the relief drawn 1.6 times as steep.
	const LIGHT = (() => {
		const alt = (40 * Math.PI) / 180;
		const az = (315 * Math.PI) / 180;
		// x east, z south: north-west is −x, −z.
		return [
			Math.cos(alt) * Math.sin(az),
			Math.sin(alt),
			-Math.cos(alt) * Math.cos(az),
		];
	})();
	const SHADE = new Float32Array(gw * gh);
	for (let j = 0; j < gh; j++)
		for (let i = 0; i < gw; i++) {
			const hx =
				(H[j * gw + Math.min(gw - 1, i + 1)] - H[j * gw + Math.max(0, i - 1)]) /
				(2 * GROUND_M);
			const hz =
				(H[Math.min(gh - 1, j + 1) * gw + i] - H[Math.max(0, j - 1) * gw + i]) /
				(2 * GROUND_M);
			const ex = 1.6;
			const nx = -hx * ex;
			const nz = -hz * ex;
			const len = Math.hypot(nx, 1, nz);
			const lit = (nx * LIGHT[0] + LIGHT[1] + nz * LIGHT[2]) / len;
			// 1 on the flat, brighter facing the sun, darker away from it.
			SHADE[j * gw + i] = lit / LIGHT[1];
		}

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
		(x - west) / MAP_MPP,
		(z - z0) / MAP_MPP,
	];
	// The water: lakes and rivers filled, streams a line at least 1.6 px wide.
	const wet = new Float32Array(w * h);
	const flowing = new Float32Array(w * h);
	for (const water of world.waters) {
		if (!water.run) {
			fillRing(wet, w, h, water.outline, toPx);
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
		strokeLine(flowing, w, h, mid, Math.max(1.6, wide / MAP_MPP));
	}
	// The shore: a band just inside the water's edge, from how much of a pixel's neighbourhood is water.
	const near = (
		A: Float32Array,
		k: number,
		x: number,
		y: number,
		r: number,
	) => {
		let lo = A[k];
		for (let dy = -r; dy <= r; dy++)
			for (let dx = -r; dx <= r; dx++) {
				const xx = x + dx;
				const yy = y + dy;
				if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
				lo = Math.min(lo, A[yy * w + xx]);
			}
		return lo;
	};

	const water = c('biome-water');
	const shore = lerp3(water, [16, 18, 52], 0.45);
	const rim = [24, 18, 52];
	const rgb = new Uint8Array(w * h * 3);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const k = y * w + x;
			const wx = west + (x + 0.5) * MAP_MPP;
			const wz = z0 + (y + 0.5) * MAP_MPP;
			const fx = (wx - gx0) / GROUND_M;
			const fz = (wz - gz0) / GROUND_M;
			const lit = field(SHADE, fx, fz);
			const ao = field(AO, fx, fz);
			const light =
				Math.min(1.3, Math.max(0.62, 1 + (lit - 1) * 0.75)) *
				(0.88 + 0.12 * ao);
			let col = [
				field(R, fx, fz) * light,
				field(G, fx, fz) * light,
				field(B, fx, fz) * light,
			];
			const sheet = Math.max(wet[k], flowing[k]);
			if (sheet > 0) {
				const band = wet[k] - near(wet, k, x, y, 2);
				const body = lerp3(water, shore, Math.min(1, band * 1.4));
				col = lerp3(col, body, sheet);
			}
			// The rim: the picture darkens toward its edge, its corners most.
			const ux = (x + 0.5) / w - 0.5;
			const uy = (y + 0.5) / h - 0.5;
			const r = Math.hypot(ux * 2, uy * 2) / Math.SQRT2;
			const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
			const v = 0.42 * smooth(0.6, 1.05, r) + 0.35 * (1 - smooth(0, 14, edge));
			col = lerp3(col, rim, v);
			rgb[k * 3] = Math.round(Math.min(255, Math.max(0, col[0])));
			rgb[k * 3 + 1] = Math.round(Math.min(255, Math.max(0, col[1])));
			rgb[k * 3 + 2] = Math.round(Math.min(255, Math.max(0, col[2])));
		}
	return { rgb, w, h };
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

/** Rough width of a name in metres at `size` metres a letter: for keeping two names apart. */
const widthOf = (name: string, size: number) => name.length * size * 0.58;

/** Font sizes in the map's metres, as MapOverview.svelte draws them. */
export const MAP_TYPE = { village: 150, pass: 160, water: 210 } as const;

/**
 * What the page draws over the picture: the roads, the names and where each
 * is written, so no two overlap. `world` is the Col de Berne loop's: its
 * other roads are every road on the map.
 */
export function mapData(world: World, route: Route): MapData {
	const { west, east, south, north } = MAP_BOUNDS;
	const loops = MAP_LOOPS.map((id) =>
		designedLine(DESIGNS.find((d) => d.id === id)!),
	);
	const spurs = world.sides.filter((s) => s.route.name === 'spur');
	const bridges: [number, number][][] = [];
	for (const [from, to] of world.bridges)
		bridges.push(pointsOf(route, from, to));
	for (const s of world.sides)
		for (const [from, to] of s.bridges)
			bridges.push(pointsOf(s.route, from, to));
	const scene = sceneOf(route.scene)!;
	const galleries = scene.galleries.flatMap(([a, b]) => {
		for (const l of loops) {
			const ia = nearestOn(l, a[0], a[1]);
			const ib = nearestOn(l, b[0], b[1]);
			if (ia.d < 30 && ib.d < 30) {
				const [p, q] = [ia.m, ib.m].sort((u, v) => u - v);
				return [pointsOf(l, p, q)];
			}
		}
		return [];
	});
	const labels = placeLabels(
		world,
		route,
		loops,
		spurs.map((s) => s.route),
	);
	return {
		name: MAP_NAME,
		bounds: MAP_BOUNDS,
		image: {
			w: Math.round((east - west) / MAP_MPP),
			h: Math.round((north - south) / MAP_MPP),
			mpp: MAP_MPP,
		},
		loops: MAP_LOOPS,
		roads: {
			loops: pathOf(
				loops.map((l) => pointsOf(l, 0, l.length, 6)),
				true,
			),
			spurs: pathOf(spurs.map((s) => pointsOf(s.route, 0, s.route.length, 6))),
			bridges: pathOf(bridges),
			galleries: pathOf(galleries),
		},
		labels,
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
): Label[] {
	// Every road every 40 m: a name is written beside a road, not over it.
	const roadPts = [...loops, ...spurs].flatMap((r) =>
		pointsOf(r, 0, r.length, 40),
	);
	const { west, east, south, north } = MAP_BOUNDS;
	const taken: Box[] = [];
	// The cartouche's corner, the north arrow's and the scale bar's: no name there.
	taken.push([west, -north, west + 2700, -north + 1150]);
	taken.push([east - 800, -north, east, -north + 1150]);
	taken.push([west, -south - 700, west + 2700, -south]);
	const inside = (b: Box) =>
		b[0] > west + 80 &&
		b[2] < east - 80 &&
		b[1] > -north + 80 &&
		b[3] < -south - 80;
	const out: Label[] = [];
	const place = (
		base: Omit<Label, 'tx' | 'tz' | 'anchor'>,
		size: number,
		lines: number,
		gap: number,
	) => {
		const wide = Math.max(
			widthOf(base.name, size),
			base.ele ? widthOf('0000 m', size * 0.8) : 0,
		);
		const tall = size * (lines === 2 ? 1.95 : 1.05);
		const tries: [number, number, Label['anchor']][] = [
			[base.x + gap, base.z + size * 0.35, 'start'],
			[base.x - gap, base.z + size * 0.35, 'end'],
			[base.x, base.z - gap - (lines - 1) * size * 0.9, 'middle'],
			[base.x, base.z + gap + size * 0.8, 'middle'],
			[base.x + gap * 0.8, base.z - gap * 0.9, 'start'],
			[base.x + gap * 0.8, base.z + gap + size * 0.6, 'start'],
			[base.x - gap * 0.8, base.z - gap * 0.9, 'end'],
			[base.x - gap * 0.8, base.z + gap + size * 0.6, 'end'],
		];
		const boxOf = ([tx, tz, a]: (typeof tries)[number]): Box => {
			const x0 = a === 'start' ? tx : a === 'end' ? tx - wide : tx - wide / 2;
			return [
				x0 - 20,
				tz - size * 0.85,
				x0 + wide + 20,
				tz - size * 0.85 + tall + 10,
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
	const passes = sceneOf(route.scene)!.names.passes.map((p) => {
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
	for (const p of passes) taken.push([p.x - 70, p.z - 80, p.x + 70, p.z + 60]);
	for (const p of passes)
		place(
			{
				kind: 'pass',
				name: p.name,
				x: Math.round(p.x),
				z: Math.round(p.z),
				ele: Math.round(p.ele),
			},
			MAP_TYPE.pass,
			2,
			110,
		);

	for (const v of villagesOf(world, route))
		place(
			{ kind: 'village', name: v.name, x: Math.round(v.x), z: Math.round(v.z) },
			MAP_TYPE.village,
			1,
			95,
		);

	for (const wn of WATER_NAMES) {
		const x = wn.at[0];
		const z = -wn.at[1];
		let angle = 0;
		if (wn.river) {
			// Along the river where the name is written.
			const r = world.waters.find(
				(w) =>
					!w.run &&
					w.outline.some(([ox, oz]) => Math.hypot(ox - x, oz - z) < 400),
			);
			if (r) {
				const near = r.outline
					.map(([ox, oz], i) => ({ i, d: Math.hypot(ox - x, oz - z) }))
					.sort((a, b) => a.d - b.d)[0];
				const o = r.outline;
				const a = o[Math.max(0, near.i - 3)];
				const b = o[Math.min(o.length - 1, near.i + 3)];
				angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
				if (angle > 90) angle -= 180;
				if (angle < -90) angle += 180;
			}
		}
		out.push({
			kind: wn.river ? 'river' : 'water',
			name: wn.name,
			x,
			z,
			tx: x,
			tz: z,
			anchor: 'middle',
			...(angle && { angle: Math.round(angle) }),
		});
	}
	return out;
}

/** The villages where they stand: the sites the world's props are built round, each by its name. */
function villagesOf(world: World, route: Route) {
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
	const { west, east, south, north } = MAP_BOUNDS;
	return sites.filter(
		(v) => v.x > west && v.x < east && v.z > -north && v.z < -south,
	);
}
