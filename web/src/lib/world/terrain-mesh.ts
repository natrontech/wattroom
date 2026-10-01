// The drawn ground, chunk by chunk on the world lattice (#3075): a 160 m
// chunk is a 40 m grid, or a 10 m one near a road or the camera, or — far
// from a ride's eye — one 160 m quad (#3606). Every vertex stands on a
// lattice point and takes the ground's height there, so two neighbours agree
// wherever both have a vertex; an edge that borders coarser ground takes that
// edge's straight line, so the two meet with no crack. heightAt reads the
// triangles actually drawn, so whatever stands on the ground stands on what
// the rider sees.
import { Biome } from './biome';
import { shadeOf, type LandUse } from './land';
import { CHUNK_M, COARSE_M, FINE_M } from './place/lattice';
import type { Ground } from './terrain/ground';
import type { Line } from './terrain/lines';

export type TerrainMesh = {
	pos: Float32Array;
	biome: Uint8Array;
	shade: Float32Array;
	forest: Float32Array;
	index: Uint32Array;
};

export type Level = 'fine' | 'coarse' | 'far';
/** How finely a chunk is drawn, by its index in the local frame; null where none is. */
export type Coverage = (ci: number, cj: number) => Level | null;
export type ChunkAt = readonly [ci: number, cj: number];
/** Metres between a level's vertices. */
export const STEP: Record<Level, number> = {
	fine: FINE_M,
	coarse: COARSE_M,
	far: CHUNK_M,
};
/** The step each edge of a chunk is drawn at, west, east, north and south: its own, or its coarser neighbour's. */
export type Edges = readonly [w: number, e: number, n: number, s: number];

/** Chunks nearer a road than this are drawn fine: the road's earthworks all lie within it. */
export const FINE_WITHIN = 60;
/** The shade's reach, in metres: hollows darker, crests lighter over about this. */
const SHADE_M = 3 * FINE_M;

/** Metres from a point to a chunk's square. */
export function toChunk(x: number, z: number, ci: number, cj: number) {
	const dx = Math.max(ci * CHUNK_M - x, 0, x - (ci + 1) * CHUNK_M);
	const dz = Math.max(cj * CHUNK_M - z, 0, z - (cj + 1) * CHUNK_M);
	return Math.sqrt(dx * dx + dz * dz);
}

/** The nearest any line comes to each chunk within `reach` of one, from vertices at most 20 m apart. */
function roadReach(
	lines: readonly Line[],
	reach: number,
	keep: (ci: number, cj: number) => boolean,
) {
	const best = new Map<string, { c: ChunkAt; d: number }>();
	const span = Math.ceil(reach / CHUNK_M);
	for (const l of lines) {
		let since = Infinity;
		for (let i = 0; i < l.x.length; i++) {
			if (i > 0)
				since += Math.sqrt(
					(l.x[i] - l.x[i - 1]) ** 2 + (l.z[i] - l.z[i - 1]) ** 2,
				);
			if (since < 20 && i < l.x.length - 1) continue;
			since = 0;
			const ci0 = Math.floor(l.x[i] / CHUNK_M);
			const cj0 = Math.floor(l.z[i] / CHUNK_M);
			for (let cj = cj0 - span; cj <= cj0 + span; cj++)
				for (let ci = ci0 - span; ci <= ci0 + span; ci++) {
					if (!keep(ci, cj)) continue;
					const d = toChunk(l.x[i], l.z[i], ci, cj);
					if (d > reach) continue;
					const id = `${ci}:${cj}`;
					const was = best.get(id);
					if (!was || d < was.d) best.set(id, { c: [ci, cj], d });
				}
		}
	}
	return best;
}

/**
 * The whole corridor at once: every chunk within `reach` of a road. A world
 * that small fills the box the corridor spans instead — a loop's inside, the
 * diorama's square edge — up to `fill` chunks, about 150k coarse vertices; a
 * longer road keeps to its corridor. Which chunks, never how finely: that is
 * the place's (placeLevel). What a world places its props over and the
 * diorama draws; a ride streams disc() around the rider.
 */
export function corridor(lines: readonly Line[], reach: number, fill = 6000) {
	const near = roadReach(lines, reach, () => true);
	const [i0, j0, i1, j1] = [...near.values()].reduce(
		([a, b, c, d], { c: [ci, cj] }) => [
			Math.min(a, ci),
			Math.min(b, cj),
			Math.max(c, ci),
			Math.max(d, cj),
		],
		[Infinity, Infinity, -Infinity, -Infinity],
	);
	if ((i1 - i0 + 1) * (j1 - j0 + 1) <= fill) {
		const chunks: ChunkAt[] = [];
		for (let cj = j0; cj <= j1; cj++)
			for (let ci = i0; ci <= i1; ci++) chunks.push([ci, cj]);
		return { chunks };
	}
	return { chunks: [...near.values()].map((c) => c.c) };
}

/**
 * How finely the place draws each chunk, wherever the camera is: fine near a
 * road, where its earthworks lie, coarse everywhere else. A chunk's grid is
 * then the same whichever chunks around it are drawn, so a streamed ground
 * only ever adds and drops chunks — none changes under the rider, no seam
 * opens — and a prop stands on exactly the ground drawn under it.
 */
export function placeLevel(lines: readonly Line[]): Coverage {
	const fine = roadReach(lines, FINE_WITHIN, () => true);
	return (ci, cj) => (fine.has(`${ci}:${cj}`) ? 'fine' : 'coarse');
}

/** Every chunk within `reach` metres of (cx, cz), nearest first. */
export function disc(cx: number, cz: number, reach: number): ChunkAt[] {
	const r = Math.ceil(reach / CHUNK_M);
	const ci0 = Math.floor(cx / CHUNK_M);
	const cj0 = Math.floor(cz / CHUNK_M);
	const out: { c: ChunkAt; d: number }[] = [];
	for (let cj = cj0 - r; cj <= cj0 + r; cj++)
		for (let ci = ci0 - r; ci <= ci0 + r; ci++) {
			const d = toChunk(cx, cz, ci, cj);
			if (d <= reach) out.push({ c: [ci, cj], d });
		}
	return out.sort((a, b) => a.d - b.d).map((o) => o.c);
}

/**
 * How far around a ride's eye the ground is drawn (#3606): the place's own
 * detail out to `near`, one quad a chunk out to `far`. `far` reaches as far
 * as a small world's whole corridor was drawn from its start; both are
 * proposals, and #3082 measures them.
 */
export const REACH = { near: 4000, far: 10_000 };

/**
 * The ground around a camera (docs/SPEC.md proposals, #3082 measures them):
 * everything within `ground` metres, fine within `fine` and wherever a road
 * runs. Two worlds built around one camera draw every chunk alike, so level
 * of detail never hides a difference between them (#3226).
 */
export function around(
	lines: readonly Line[],
	cx: number,
	cz: number,
	reach = { ground: REACH.near, fine: 1200 },
) {
	const inside = (ci: number, cj: number) =>
		toChunk(cx, cz, ci, cj) <= reach.ground;
	const roads = roadReach(lines, FINE_WITHIN, inside);
	const level: Coverage = (ci, cj) => {
		const d = toChunk(cx, cz, ci, cj);
		if (d > reach.ground) return null;
		return d <= reach.fine || roads.has(`${ci}:${cj}`) ? 'fine' : 'coarse';
	};
	const r = Math.ceil(reach.ground / CHUNK_M);
	const ci0 = Math.floor(cx / CHUNK_M);
	const cj0 = Math.floor(cz / CHUNK_M);
	const chunks: ChunkAt[] = [];
	for (let cj = cj0 - r; cj <= cj0 + r; cj++)
		for (let ci = ci0 - r; ci <= ci0 + r; ci++)
			if (level(ci, cj)) chunks.push([ci, cj]);
	return { level, chunks };
}

/** One chunk's drawn ground: a grid of `row` × `row` vertices `step` metres apart. */
export type Grid = {
	step: number;
	row: number;
	h: Float32Array;
	biome: Uint8Array;
	shade: Float32Array;
	forest: Float32Array;
};

// Height on a grid of `row` columns at fractional (fx, fz), triangle by
// triangle — the same split the index uses (a, a+row, a+1 | a+1, a+row, a+row+1).
function onGrid(h: Float32Array, row: number, fx: number, fz: number) {
	const ix = Math.min(row - 2, Math.floor(fx));
	const iz = Math.min(row - 2, Math.floor(fz));
	const tx = fx - ix;
	const tz = fz - iz;
	const a = h[iz * row + ix];
	const b = h[iz * row + ix + 1];
	const c = h[(iz + 1) * row + ix];
	const d = h[(iz + 1) * row + ix + 1];
	return tx + tz <= 1
		? a + (b - a) * tx + (c - a) * tz
		: d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
}

/** How each edge of (ci, cj) is drawn under `coverage`: at the coarser of its own step and its neighbour's; a coarse one where none is drawn. */
export function edgesOf(coverage: Coverage, ci: number, cj: number): Edges {
	const own = STEP[coverage(ci, cj) ?? 'coarse'];
	const at = (i: number, j: number) =>
		Math.max(own, STEP[coverage(i, j) ?? 'coarse']);
	return [at(ci - 1, cj), at(ci + 1, cj), at(ci, cj - 1), at(ci, cj + 1)];
}

/** A chunk's grid, where `coverage` draws one. */
export function gridOf(
	ground: Ground,
	land: LandUse,
	coverage: Coverage,
	ci: number,
	cj: number,
): Grid | null {
	const level = coverage(ci, cj);
	return level
		? gridAt(ground, land, ci, cj, level, edgesOf(coverage, ci, cj))
		: null;
}

/**
 * A chunk's grid at `level`: every vertex on the lattice at the ground's
 * height there, and a vertex on an edge drawn coarser than the chunk on that
 * edge's straight line. Pure: a worker builds the same bytes (#3606).
 */
export function gridAt(
	ground: Ground,
	land: LandUse,
	ci: number,
	cj: number,
	level: Level,
	edges: Edges,
): Grid {
	// Every height this chunk asks for lies on the 10 m lattice; neighbours ask for the same ones.
	const asked = new Map<number, number>();
	const groundAt = (x: number, z: number) => {
		const k = Math.round(x / FINE_M) * 1e7 + Math.round(z / FINE_M);
		let h = asked.get(k);
		if (h === undefined) asked.set(k, (h = ground.drawnAt(x, z)));
		return h;
	};
	const step = STEP[level];
	const n = CHUNK_M / step;
	const row = n + 1;
	const x0 = ci * CHUNK_M;
	const z0 = cj * CHUNK_M;
	const [pw, pe, pn, ps] = edges.map((e) => e / step);
	const h = new Float32Array(row * row);
	for (let j = 0; j <= n; j++)
		for (let i = 0; i <= n; i++) {
			const x = x0 + i * step;
			const z = z0 + j * step;
			// A vertex on an edge drawn coarser lies on that edge's straight line.
			const perZ = i === 0 ? pw : i === n ? pe : 1;
			const perX = j === 0 ? pn : j === n ? ps : 1;
			const offZ = j % perZ;
			const offX = i % perX;
			if (offZ !== 0) {
				const za = z - offZ * step;
				const t = offZ / perZ;
				h[j * row + i] =
					groundAt(x, za) * (1 - t) + groundAt(x, za + perZ * step) * t;
			} else if (offX !== 0) {
				const xa = x - offX * step;
				const t = offX / perX;
				h[j * row + i] =
					groundAt(xa, z) * (1 - t) + groundAt(xa + perX * step, z) * t;
			} else h[j * row + i] = groundAt(x, z);
		}
	const biome = new Uint8Array(row * row);
	const shade = new Float32Array(row * row);
	const forest = new Float32Array(row * row);
	// Land use reads the fine ground whatever the chunk draws, so both sides of a seam agree.
	for (let j = 0; j <= n; j++)
		for (let i = 0; i <= n; i++) {
			const k = j * row + i;
			const x = x0 + i * step;
			const z = z0 + j * step;
			const l = groundAt(x - FINE_M, z);
			const r = groundAt(x + FINE_M, z);
			const u = groundAt(x, z - FINE_M);
			const dn = groundAt(x, z + FINE_M);
			const cover = land(
				x,
				z,
				h[k],
				(r - l) / (2 * FINE_M),
				(dn - u) / (2 * FINE_M),
				ground.nearest(x, z, 1)?.d ?? Infinity,
			);
			biome[k] = cover.biome;
			forest[k] = cover.forest;
			shade[k] = shadeOf(h[k], l, r, u, dn, SHADE_M);
		}
	return { step, row, h, biome, shade, forest };
}

/** Chunks' grids as one mesh, in the order listed; a chunk with no grid is left out. */
export function meshOf(
	list: readonly { ci: number; cj: number; grid: Grid | null }[],
): TerrainMesh {
	const drawn = list.filter(
		(c): c is { ci: number; cj: number; grid: Grid } => !!c.grid,
	);
	const verts = drawn.reduce((s, c) => s + c.grid.row * c.grid.row, 0);
	const tris = drawn.reduce((s, c) => s + 2 * (c.grid.row - 1) ** 2, 0);
	const pos = new Float32Array(verts * 3);
	const biome = new Uint8Array(verts);
	const shade = new Float32Array(verts);
	const forest = new Float32Array(verts);
	const index = new Uint32Array(tris * 3);
	let v = 0;
	let t = 0;
	for (const { ci, cj, grid: b } of drawn) {
		const { row, step } = b;
		for (let j = 0; j < row; j++)
			for (let i = 0; i < row; i++) {
				const k = j * row + i;
				pos[(v + k) * 3] = ci * CHUNK_M + i * step;
				pos[(v + k) * 3 + 1] = b.h[k];
				pos[(v + k) * 3 + 2] = cj * CHUNK_M + j * step;
			}
		biome.set(b.biome, v);
		shade.set(b.shade, v);
		forest.set(b.forest, v);
		for (let j = 0; j < row - 1; j++)
			for (let i = 0; i < row - 1; i++) {
				const a = v + j * row + i;
				index.set([a, a + row, a + 1, a + 1, a + row, a + row + 1], t);
				t += 6;
			}
		v += row * row;
	}
	return { pos, biome, shade, forest, index };
}

export function createTerrain(
	ground: Ground,
	coverage: Coverage,
	land: LandUse,
) {
	const built = new Map<string, Grid | null>();

	function chunk(ci: number, cj: number): Grid | null {
		const id = `${ci}:${cj}`;
		if (!built.has(id)) built.set(id, gridOf(ground, land, coverage, ci, cj));
		return built.get(id)!;
	}

	/** A chunk already built, without building it: undefined until something asks for it. */
	const peek = (ci: number, cj: number) => built.get(`${ci}:${cj}`);

	/** Where (x, z) lies in its chunk's grid, when a chunk is drawn there. */
	function locate(x: number, z: number) {
		const ci = Math.floor(x / CHUNK_M);
		const cj = Math.floor(z / CHUNK_M);
		const b = chunk(ci, cj);
		if (!b) return null;
		return {
			b,
			fx: (x - ci * CHUNK_M) / b.step,
			fz: (z - cj * CHUNK_M) / b.step,
		};
	}

	/** The drawn ground's height; the ground's own where nothing is drawn. */
	function heightAt(x: number, z: number): number {
		const at = locate(x, z);
		return at ? onGrid(at.b.h, at.b.row, at.fx, at.fz) : ground.heightAt(x, z);
	}

	/** What grows at the drawn vertex nearest (x, z); null where no ground is drawn. */
	function biomeAt(x: number, z: number): Biome | null {
		const at = locate(x, z);
		if (!at) return null;
		return at.b.biome[
			Math.round(at.fz) * at.b.row + Math.round(at.fx)
		] as Biome;
	}

	/** The listed chunks as one mesh. */
	const mesh = (chunks: readonly ChunkAt[]): TerrainMesh =>
		meshOf(chunks.map(([ci, cj]) => ({ ci, cj, grid: chunk(ci, cj) })));

	/**
	 * The outline of the listed chunks: every edge with no listed neighbour,
	 * as segments ax, ay, az, bx, by, bz — where a plinth stands its walls.
	 */
	function rim(chunks: readonly ChunkAt[]): number[] {
		const listed = new Set(chunks.map(([ci, cj]) => `${ci}:${cj}`));
		const open = (ci: number, cj: number) => !listed.has(`${ci}:${cj}`);
		const out: number[] = [];
		for (const [ci, cj] of chunks) {
			const b = chunk(ci, cj);
			if (!b) continue;
			const n = b.row - 1;
			const vertex = (i: number, j: number) => [
				ci * CHUNK_M + i * b.step,
				b.h[j * b.row + i],
				cj * CHUNK_M + j * b.step,
			];
			const sides: [boolean, (s: number) => number[]][] = [
				[open(ci - 1, cj), (s) => vertex(0, s)],
				[open(ci + 1, cj), (s) => vertex(n, s)],
				[open(ci, cj - 1), (s) => vertex(s, 0)],
				[open(ci, cj + 1), (s) => vertex(s, n)],
			];
			for (const [edge, at] of sides)
				if (edge) for (let s = 0; s < n; s++) out.push(...at(s), ...at(s + 1));
		}
		return out;
	}

	return { heightAt, biomeAt, mesh, rim, chunk, peek };
}

export type Terrain = ReturnType<typeof createTerrain>;
