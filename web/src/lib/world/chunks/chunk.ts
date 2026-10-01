import { keyed, type Kind } from '../place/keyed';
import {
	CHUNK_M,
	COARSE_M,
	FINE_M,
	cellsOf,
	type Cell,
	type CellSize,
} from '../place/lattice';
import { keyAt, regionAt, type Keying } from '../place/region';
import { nearest, type StrokeIndex } from './stroke-index';

/**
 * One world chunk (#3074): 160 m of the lattice, and in it one keyed
 * decision per cell for each layer the generator reads — the ground and the
 * houses per coarse cell, trees and props per fine cell, the biome once. The
 * terrain, props and set pieces (#3075–#3077) turn these into geometry; this
 * is the part every one of them shares, and the part two routes through one
 * place must agree on to the bit.
 *
 * Outside private regions a cell's key is the world salt's, in the world
 * lattice (ADR-0081): nothing about the route enters it. A cell whose
 * nearest point on the served road lies in a private region is keyed by
 * that region's own salt in its own cells (#3224).
 */

export const LAYERS: readonly { kind: Kind; size: CellSize }[] = [
	{ kind: 'biome', size: CHUNK_M },
	{ kind: 'ground', size: COARSE_M },
	{ kind: 'house', size: COARSE_M },
	{ kind: 'tree', size: FINE_M },
	{ kind: 'prop', size: FINE_M },
];

/** Words in a chunk: one per cell of every layer, in LAYERS order, cells row by row. */
export const CHUNK_WORDS = LAYERS.reduce(
	(n, l) => n + (CHUNK_M / l.size) * (CHUNK_M / l.size),
	0,
);

/** A chunk's name within a data snapshot: what the cache and the worker key it by. */
export const chunkId = (snapshot: string, chunk: Cell): string =>
	`${snapshot}/${chunk.i}:${chunk.j}`;

export function buildChunk(
	chunk: Cell,
	keying: Keying,
	index: StrokeIndex,
): Uint32Array {
	const out = new Uint32Array(CHUNK_WORDS);
	let w = 0;
	for (const { kind, size } of LAYERS)
		for (const cell of cellsOf(chunk, size)) {
			let key = keyed(keying.salt, kind, cell.i, cell.j);
			if (keying.regions.length > 0) {
				const at = nearest(index, (cell.i + 0.5) * size, (cell.j + 0.5) * size);
				if (at && regionAt(keying, at.along))
					key = keyAt(keying, kind, at.along, at.offset, size);
			}
			out[w++] = key;
		}
	return out;
}
