// One crack-free surface: coarse vertices everywhere, coarse triangles
// outside the fine chunks, then each fine chunk's own grid. A fine edge that
// borders coarse ground takes the coarse edge's straight line, so the two
// meet with no crack — and heightAt reads the triangles actually drawn, so
// whatever stands on the ground stands on what the rider sees.
import { shadeOf, type LandUse } from './land';

export const CH = 4; // coarse cells per chunk
export const F = 4; // fine subdivisions per coarse cell (40 m → 10 m)

export type TerrainMesh = {
	pos: Float32Array;
	biome: Uint8Array;
	shade: Float32Array;
	forest: Float32Array;
	index: Uint32Array;
};

export type Grid = {
	nx: number;
	nz: number;
	x0: number;
	z0: number;
	cell: number;
	height: Float32Array;
	roadDist: Float32Array;
	biome: Uint8Array;
	forest: Float32Array;
	fine: (cx: number, cz: number) => boolean; // does this chunk get fine terrain?
};

// The true ground at a fine vertex: its height and its distance to the road.
// `coarseD` is the coarse grid's distance interpolated at the vertex, for a
// vertex farther out than the road index searches.
export type Probe = (
	x: number,
	z: number,
	coarseD: number,
) => { h: number; d: number };

// Height on a grid of `row` columns at fractional (fx, fz), triangle by
// triangle — the same split the index uses (a, a+row, a+1 | a+1, a+row, a+row+1).
function onGrid(h: Float32Array, row: number, fx: number, fz: number) {
	const ix = Math.floor(fx);
	const iz = Math.floor(fz);
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

export function buildMesh(g: Grid, probe: Probe, land: LandUse) {
	const { nx, nz, cell, height, roadDist } = g;
	const N = nx * nz;
	const ncx = (nx - 1) / CH;
	const ncz = (nz - 1) / CH;
	const X = (ix: number) => g.x0 + ix * cell;
	const Z = (iz: number) => g.z0 + iz * cell;
	const pos: number[] = [];
	const bio: number[] = [];
	const shade: number[] = [];
	const forest: number[] = [];
	const index: number[] = [];
	for (let k = 0; k < N; k++) {
		const ix = k % nx;
		const iz = Math.floor(k / nx);
		pos.push(X(ix), height[k], Z(iz));
		bio.push(g.biome[k]);
		forest.push(g.forest[k]);
		const at = (a: number, b: number) =>
			height[
				Math.min(nz - 1, Math.max(0, b)) * nx + Math.min(nx - 1, Math.max(0, a))
			];
		shade.push(
			shadeOf(
				height[k],
				at(ix - 1, iz),
				at(ix + 1, iz),
				at(ix, iz - 1),
				at(ix, iz + 1),
				cell,
			),
		);
	}
	for (let iz = 0; iz < nz - 1; iz++)
		for (let ix = 0; ix < nx - 1; ix++) {
			if (g.fine(Math.floor(ix / CH), Math.floor(iz / CH))) continue;
			const a = iz * nx + ix;
			index.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
		}

	const fs = cell / F;
	const M = CH * F + 1;
	const fineChunks = new Map<number, Float32Array>(); // chunk → its drawn heights
	const fineD = new Float32Array(M * M);
	for (let cz = 0; cz < ncz; cz++)
		for (let cx = 0; cx < ncx; cx++) {
			if (!g.fine(cx, cz)) continue;
			const ox = cx * CH;
			const oz = cz * CH;
			const fineH = new Float32Array(M * M);
			fineChunks.set(cz * ncx + cx, fineH);
			for (let j = 0; j < M; j++)
				for (let i = 0; i < M; i++) {
					const k = j * M + i;
					const cornerI = i % F === 0;
					const cornerJ = j % F === 0;
					const edgeToCoarse =
						(i === 0 && !g.fine(cx - 1, cz)) ||
						(i === M - 1 && !g.fine(cx + 1, cz)) ||
						(j === 0 && !g.fine(cx, cz - 1)) ||
						(j === M - 1 && !g.fine(cx, cz + 1));
					const onChunkCorner =
						(i === 0 || i === M - 1) && (j === 0 || j === M - 1);
					if (cornerI && cornerJ && (onChunkCorner || edgeToCoarse)) {
						const c = (oz + j / F) * nx + ox + i / F; // a coarse vertex
						fineH[k] = height[c];
						fineD[k] = roadDist[c];
					} else if (edgeToCoarse && (i === 0 || i === M - 1)) {
						const a = (oz + Math.floor(j / F)) * nx + ox + i / F;
						const t = (j % F) / F;
						fineH[k] = height[a] * (1 - t) + height[a + nx] * t;
						fineD[k] = roadDist[a] * (1 - t) + roadDist[a + nx] * t;
					} else if (edgeToCoarse) {
						const a = (oz + j / F) * nx + ox + Math.floor(i / F);
						const t = (i % F) / F;
						fineH[k] = height[a] * (1 - t) + height[a + 1] * t;
						fineD[k] = roadDist[a] * (1 - t) + roadDist[a + 1] * t;
					} else {
						const p = probe(
							X(ox) + i * fs,
							Z(oz) + j * fs,
							onGrid(
								roadDist,
								nx,
								Math.min(nx - 1.0001, ox + i / F),
								Math.min(nz - 1.0001, oz + j / F),
							),
						);
						fineH[k] = p.h;
						fineD[k] = p.d;
					}
				}
			const base = pos.length / 3;
			const h = (a: number, b: number) =>
				fineH[
					Math.min(M - 1, Math.max(0, b)) * M + Math.min(M - 1, Math.max(0, a))
				];
			for (let j = 0; j < M; j++)
				for (let i = 0; i < M; i++) {
					const k = j * M + i;
					const x = X(ox) + i * fs;
					const z = Z(oz) + j * fs;
					pos.push(x, fineH[k], z);
					const cover = land(
						x,
						z,
						fineH[k],
						(h(i + 1, j) - h(i - 1, j)) / (2 * fs),
						(h(i, j + 1) - h(i, j - 1)) / (2 * fs),
						fineD[k],
					);
					bio.push(cover.biome);
					forest.push(cover.forest);
					shade.push(
						shadeOf(
							fineH[k],
							h(i - 1, j),
							h(i + 1, j),
							h(i, j - 1),
							h(i, j + 1),
							fs * 3,
						),
					);
				}
			for (let j = 0; j < M - 1; j++)
				for (let i = 0; i < M - 1; i++) {
					const a = base + j * M + i;
					index.push(a, a + M, a + 1, a + 1, a + M, a + M + 1);
				}
		}

	const heightAt = (x: number, z: number) => {
		const gx = Math.min(nx - 1.0001, Math.max(0, (x - g.x0) / cell));
		const gz = Math.min(nz - 1.0001, Math.max(0, (z - g.z0) / cell));
		const cx = Math.floor(gx / CH);
		const cz = Math.floor(gz / CH);
		const chunk = fineChunks.get(cz * ncx + cx);
		if (chunk)
			return onGrid(
				chunk,
				M,
				Math.min(M - 1.0001, (gx - cx * CH) * F),
				Math.min(M - 1.0001, (gz - cz * CH) * F),
			);
		return onGrid(height, nx, gx, gz);
	};

	const mesh: TerrainMesh = {
		pos: new Float32Array(pos),
		biome: new Uint8Array(bio),
		shade: new Float32Array(shade),
		forest: new Float32Array(forest),
		index: new Uint32Array(index),
	};
	return { mesh, heightAt };
}
