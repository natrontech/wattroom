// The drawn ground, chunk by chunk on the world lattice (#3075): a 160 m
// chunk is a 40 m grid, or a 10 m one near a road or the camera, or — far
// from a ride's eye — one 160 m quad (#3606). Every vertex stands on a
// lattice point and takes the ground's height there, so two neighbours agree
// wherever both have a vertex; an edge that borders coarser ground takes that
// edge's straight line, so the two meet with no crack. heightAt reads the
// triangles actually drawn, so whatever stands on the ground stands on what
// the rider sees.
import { Biome } from './biome';
import type { LandUse } from './land';
import { CHUNK_M, COARSE_M, FINE_M } from './place/lattice';
import type { Ground } from './terrain/ground';
import type { Line } from './terrain/lines';
import {
	chunkVertices,
	onGrid,
	type ChunkVertices,
	type Grid,
} from './terrain-grid';

export type { Grid } from './terrain-grid';

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

/** How each edge of (ci, cj) is drawn under `coverage`: at the coarser of its own step and its neighbour's; a coarse one where none is drawn. */
export function edgesOf(coverage: Coverage, ci: number, cj: number): Edges {
	const own = STEP[coverage(ci, cj) ?? 'coarse'];
	const at = (i: number, j: number) =>
		Math.max(own, STEP[coverage(i, j) ?? 'coarse']);
	return [at(ci - 1, cj), at(ci + 1, cj), at(ci, cj - 1), at(ci, cj + 1)];
}

/**
 * A chunk's grid at `level`, built whole: every vertex on the lattice at the
 * ground's height there, and a vertex on an edge drawn coarser than the
 * chunk on that edge's straight line. Pure: a worker builds the same bytes
 * (#3606).
 */
export function gridAt(
	ground: Ground,
	land: LandUse,
	ci: number,
	cj: number,
	level: Level,
	edges: Edges,
): Grid {
	return chunkVertices(ground, land, ci, cj, STEP[level], edges).grid();
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
	// Chunks something has asked a point of, a vertex at a time (#3797).
	const partial = new Map<string, ChunkVertices>();

	function vertices(ci: number, cj: number, id: string, level: Level) {
		let v = partial.get(id);
		if (!v)
			partial.set(
				id,
				(v = chunkVertices(
					ground,
					land,
					ci,
					cj,
					STEP[level],
					edgesOf(coverage, ci, cj),
				)),
			);
		return v;
	}

	function chunk(ci: number, cj: number): Grid | null {
		const id = `${ci}:${cj}`;
		if (!built.has(id)) {
			const level = coverage(ci, cj);
			built.set(id, level ? vertices(ci, cj, id, level).grid() : null);
			partial.delete(id);
		}
		return built.get(id)!;
	}

	/** A chunk already built, without building it: undefined until something asks for it. */
	const peek = (ci: number, cj: number) => built.get(`${ci}:${cj}`);

	/**
	 * Where (x, z) lies in its chunk, when a chunk is drawn there: in its grid
	 * once built, else in its vertices as far as they are known. A chunk asked
	 * about this often is as well built whole, and read from its grid after.
	 */
	function locate(x: number, z: number) {
		const ci = Math.floor(x / CHUNK_M);
		const cj = Math.floor(z / CHUNK_M);
		const id = `${ci}:${cj}`;
		let b = built.get(id);
		let v: ChunkVertices | null = null;
		if (b === undefined) {
			const level = coverage(ci, cj);
			if (!level) built.set(id, (b = null));
			else {
				v = vertices(ci, cj, id, level);
				if (v.known() * 4 >= v.row * v.row) {
					b = chunk(ci, cj);
					v = null;
				}
			}
		}
		if (b === null) return null;
		const step = b ? b.step : v!.step;
		return {
			b,
			v,
			fx: (x - ci * CHUNK_M) / step,
			fz: (z - cj * CHUNK_M) / step,
		};
	}

	/** The drawn ground's height; the ground's own where nothing is drawn. */
	function heightAt(x: number, z: number): number {
		const at = locate(x, z);
		if (!at) return ground.heightAt(x, z);
		return at.b
			? onGrid(at.b.h, at.b.row, at.fx, at.fz)
			: at.v!.heightAt(at.fx, at.fz);
	}

	/** What grows at the drawn vertex nearest (x, z); null where no ground is drawn. */
	function biomeAt(x: number, z: number): Biome | null {
		const at = locate(x, z);
		if (!at) return null;
		return (
			at.b
				? at.b.biome[Math.round(at.fz) * at.b.row + Math.round(at.fx)]
				: at.v!.biomeAt(at.fx, at.fz)
		) as Biome;
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
