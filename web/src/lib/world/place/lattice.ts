import { cm } from './keyed';

/**
 * The world lattice (#3224): one grid, aligned to the key frame, that every
 * road through a place shares — so two roads over the same ground ask the
 * same cells the same questions. Positions enter as floored centimetres, and
 * a cell index is an integer division of them, exact in every engine.
 */

export const FINE_M = 10;
export const COARSE_M = 40;
export const CHUNK_M = 160;
/** Heights are metres above this in every world, never above a route's own start. */
export const DATUM_M = 0;

export type CellSize = typeof FINE_M | typeof COARSE_M | typeof CHUNK_M;
export type Cell = { size: CellSize; i: number; j: number };

export function cellOf(x: number, z: number, size: CellSize): Cell {
	const side = size * 100;
	return {
		size,
		i: Math.floor(cm(x) / side),
		j: Math.floor(cm(z) / side),
	};
}

export const chunkOf = (x: number, z: number): Cell => cellOf(x, z, CHUNK_M);

/** The cells of `size` a chunk holds, row by row. */
export function cellsOf(chunk: Cell, size: CellSize): Cell[] {
	const per = CHUNK_M / size;
	const cells: Cell[] = [];
	for (let b = 0; b < per; b++)
		for (let a = 0; a < per; a++)
			cells.push({ size, i: chunk.i * per + a, j: chunk.j * per + b });
	return cells;
}

/** A cell's corner nearest the key frame's origin, in metres. */
export const cornerOf = (cell: Cell): [number, number] => [
	cell.i * cell.size,
	cell.j * cell.size,
];
