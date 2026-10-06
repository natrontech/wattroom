// One chunk's drawn ground as a grid of vertices (#3075, #3606), worked out
// a vertex at a time when only a few are asked for (#3797). A village's
// meadow or a set piece decided far behind the rider reads one point of a
// chunk nobody draws yet; it reads the vertices that point needs rather than
// all of them. Each vertex is the same bytes whichever is asked first, so a
// grid finished later is the grid a worker builds whole.
import { shadeOf, type LandUse } from './land';
import { CHUNK_M, FINE_M } from './place/lattice';
import type { Ground } from './terrain/ground';
import type { Edges } from './terrain-mesh';

/** One chunk's drawn ground: a grid of `row` × `row` vertices `step` metres apart. */
export type Grid = {
	step: number;
	row: number;
	h: Float32Array;
	biome: Uint8Array;
	shade: Float32Array;
	forest: Float32Array;
};

/** The shade's reach, in metres: hollows darker, crests lighter over about this. */
const SHADE_M = 3 * FINE_M;

// Height on a grid of `row` columns at fractional (fx, fz), triangle by
// triangle — the same split the index uses (a, a+row, a+1 | a+1, a+row, a+row+1).
export function onGrid(h: Float32Array, row: number, fx: number, fz: number) {
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

/**
 * Chunk (ci, cj)'s vertices `step` metres apart, each worked out the first
 * time something asks for it: every vertex on the lattice at the ground's
 * height there, and a vertex on an edge drawn coarser than the chunk on that
 * edge's straight line. Pure: a worker builds the same bytes.
 */
export function chunkVertices(
	ground: Ground,
	land: LandUse,
	ci: number,
	cj: number,
	step: number,
	edges: Edges,
) {
	// Every height this chunk asks for lies on the 10 m lattice; neighbours ask for the same ones.
	const asked = new Map<number, number>();
	const groundAt = (x: number, z: number) => {
		const k = Math.round(x / FINE_M) * 1e7 + Math.round(z / FINE_M);
		let h = asked.get(k);
		if (h === undefined) asked.set(k, (h = ground.drawnAt(x, z)));
		return h;
	};
	const n = CHUNK_M / step;
	const row = n + 1;
	const x0 = ci * CHUNK_M;
	const z0 = cj * CHUNK_M;
	const [pw, pe, pn, ps] = edges.map((e) => e / step);
	const h = new Float32Array(row * row);
	const biome = new Uint8Array(row * row);
	const shade = new Float32Array(row * row);
	const forest = new Float32Array(row * row);
	const hasHeight = new Uint8Array(row * row);
	const hasCover = new Uint8Array(row * row);
	let known = 0;

	/** Vertex (i, j)'s height, as the grid holds it. */
	function height(i: number, j: number): number {
		const k = j * row + i;
		if (hasHeight[k]) return h[k];
		hasHeight[k] = 1;
		known++;
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
			h[k] = groundAt(x, za) * (1 - t) + groundAt(x, za + perZ * step) * t;
		} else if (offX !== 0) {
			const xa = x - offX * step;
			const t = offX / perX;
			h[k] = groundAt(xa, z) * (1 - t) + groundAt(xa + perX * step, z) * t;
		} else h[k] = groundAt(x, z);
		return h[k];
	}

	/** Vertex (i, j)'s land use, worked out: its index in the grid. */
	function cover(i: number, j: number): number {
		const k = j * row + i;
		if (hasCover[k]) return k;
		hasCover[k] = 1;
		const hk = height(i, j);
		const x = x0 + i * step;
		const z = z0 + j * step;
		// Land use reads the fine ground whatever the chunk draws, so both sides of a seam agree.
		const l = groundAt(x - FINE_M, z);
		const r = groundAt(x + FINE_M, z);
		const u = groundAt(x, z - FINE_M);
		const dn = groundAt(x, z + FINE_M);
		const c = land(
			x,
			z,
			hk,
			(r - l) / (2 * FINE_M),
			(dn - u) / (2 * FINE_M),
			ground.nearest(x, z, 1)?.d ?? Infinity,
		);
		biome[k] = c.biome;
		forest[k] = c.forest;
		shade[k] = shadeOf(hk, l, r, u, dn, SHADE_M);
		return k;
	}

	return {
		step,
		row,
		/** How many vertices have a height so far. */
		known: () => known,
		/** The drawn height at fractional (fx, fz): the four vertices around it, nothing more. */
		heightAt(fx: number, fz: number): number {
			const ix = Math.min(row - 2, Math.floor(fx));
			const iz = Math.min(row - 2, Math.floor(fz));
			height(ix, iz);
			height(ix + 1, iz);
			height(ix, iz + 1);
			height(ix + 1, iz + 1);
			return onGrid(h, row, fx, fz);
		},
		/** What grows at the vertex nearest fractional (fx, fz). */
		biomeAt: (fx: number, fz: number): number =>
			biome[cover(Math.round(fx), Math.round(fz))],
		/** Every vertex worked out: the chunk's grid. */
		grid(): Grid {
			for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) cover(i, j);
			return { step, row, h, biome, shade, forest };
		},
	};
}

export type ChunkVertices = ReturnType<typeof chunkVertices>;
