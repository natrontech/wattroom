// The drawn ground, chunk by chunk on the world lattice (#3075): a 160 m
// chunk is a 40 m grid, or a 10 m one near a road or the camera. Every
// vertex stands on a lattice point and takes the ground's height there, so
// two neighbours agree wherever both have a vertex; a fine edge that borders
// coarse ground takes the coarse edge's straight line, so the two meet with
// no crack. heightAt reads the triangles actually drawn, so whatever stands
// on the ground stands on what the rider sees.
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

export type Level = 'fine' | 'coarse';
/** How finely a chunk is drawn, by its index in the local frame; null where none is. */
export type Coverage = (ci: number, cj: number) => Level | null;
export type ChunkAt = readonly [ci: number, cj: number];

/** Chunks nearer a road than this are drawn fine: the road's earthworks all lie within it. */
export const FINE_WITHIN = 60;
/** The shade's reach, in metres: hollows darker, crests lighter over about this. */
const SHADE_M = 3 * FINE_M;

/** Metres from a point to a chunk's square. */
function toChunk(x: number, z: number, ci: number, cj: number) {
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
 * The whole corridor at once: every chunk within `reach` of a road, fine near
 * one. A world that small fills the box the corridor spans instead — a
 * loop's inside, the diorama's square edge — up to `fill` chunks, about
 * 150k coarse vertices; a longer road keeps to its corridor. What a world
 * built before its ride uses; a streamed one asks around().
 */
export function corridor(lines: readonly Line[], reach: number, fill = 6000) {
	const near = roadReach(lines, reach, () => true);
	const fine = (ci: number, cj: number) =>
		(near.get(`${ci}:${cj}`)?.d ?? Infinity) <= FINE_WITHIN ? 'fine' : 'coarse';
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
		const level: Coverage = (ci, cj) =>
			ci < i0 || ci > i1 || cj < j0 || cj > j1 ? null : fine(ci, cj);
		return { level, chunks };
	}
	const level: Coverage = (ci, cj) =>
		near.has(`${ci}:${cj}`) ? fine(ci, cj) : null;
	return { level, chunks: [...near.values()].map((c) => c.c) };
}

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
	reach = { ground: 4000, fine: 1200 },
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

type Built = {
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

export function createTerrain(
	ground: Ground,
	coverage: Coverage,
	land: LandUse,
) {
	const built = new Map<string, Built | null>();

	function build(ci: number, cj: number): Built | null {
		const level = coverage(ci, cj);
		if (!level) return null;
		// Every height this chunk asks for lies on the 10 m lattice; neighbours ask for the same ones.
		const asked = new Map<number, number>();
		const groundAt = (x: number, z: number) => {
			const k = Math.round(x / FINE_M) * 1e7 + Math.round(z / FINE_M);
			let h = asked.get(k);
			if (h === undefined) asked.set(k, (h = ground.heightAt(x, z)));
			return h;
		};
		const step = level === 'fine' ? FINE_M : COARSE_M;
		const n = CHUNK_M / step;
		const row = n + 1;
		const x0 = ci * CHUNK_M;
		const z0 = cj * CHUNK_M;
		const per = COARSE_M / step;
		const coarseEdge = [
			coverage(ci - 1, cj) !== 'fine', // i = 0
			coverage(ci + 1, cj) !== 'fine', // i = n
			coverage(ci, cj - 1) !== 'fine', // j = 0
			coverage(ci, cj + 1) !== 'fine', // j = n
		];
		const h = new Float32Array(row * row);
		for (let j = 0; j <= n; j++)
			for (let i = 0; i <= n; i++) {
				const x = x0 + i * step;
				const z = z0 + j * step;
				// A fine vertex on an edge the neighbour draws coarse lies on that edge's straight line.
				const alongZ = (i === 0 && coarseEdge[0]) || (i === n && coarseEdge[1]);
				const alongX = (j === 0 && coarseEdge[2]) || (j === n && coarseEdge[3]);
				const offZ = j % per;
				const offX = i % per;
				if (level === 'fine' && alongZ && offZ !== 0) {
					const za = z - offZ * step;
					const t = offZ / per;
					h[j * row + i] =
						groundAt(x, za) * (1 - t) + groundAt(x, za + COARSE_M) * t;
				} else if (level === 'fine' && alongX && offX !== 0) {
					const xa = x - offX * step;
					const t = offX / per;
					h[j * row + i] =
						groundAt(xa, z) * (1 - t) + groundAt(xa + COARSE_M, z) * t;
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

	function chunk(ci: number, cj: number): Built | null {
		const id = `${ci}:${cj}`;
		if (!built.has(id)) built.set(id, build(ci, cj));
		return built.get(id)!;
	}

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
	function mesh(chunks: readonly ChunkAt[]): TerrainMesh {
		const list = chunks
			.map(([ci, cj]) => ({ ci, cj, b: chunk(ci, cj)! }))
			.filter((c) => c.b);
		const verts = list.reduce((s, c) => s + c.b.row * c.b.row, 0);
		const tris = list.reduce((s, c) => s + 2 * (c.b.row - 1) ** 2, 0);
		const pos = new Float32Array(verts * 3);
		const biome = new Uint8Array(verts);
		const shade = new Float32Array(verts);
		const forest = new Float32Array(verts);
		const index = new Uint32Array(tris * 3);
		let v = 0;
		let t = 0;
		for (const { ci, cj, b } of list) {
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

	/**
	 * The outline of the listed chunks: every edge with no drawn neighbour, as
	 * segments ax, ay, az, bx, by, bz — where a plinth stands its walls.
	 */
	function rim(chunks: readonly ChunkAt[]): number[] {
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
				[!coverage(ci - 1, cj), (s) => vertex(0, s)],
				[!coverage(ci + 1, cj), (s) => vertex(n, s)],
				[!coverage(ci, cj - 1), (s) => vertex(s, 0)],
				[!coverage(ci, cj + 1), (s) => vertex(s, n)],
			];
			for (const [open, at] of sides)
				if (open) for (let s = 0; s < n; s++) out.push(...at(s), ...at(s + 1));
		}
		return out;
	}

	return { heightAt, biomeAt, mesh, rim, chunk };
}

export type Terrain = ReturnType<typeof createTerrain>;
