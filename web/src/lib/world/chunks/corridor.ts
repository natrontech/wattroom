import { CHUNK_M, chunkOf, type Cell } from '../place/lattice';
import { STROKE_STEP_M, type Stroke } from '../place/stroke';

/**
 * The chunks a ride needs (#3074): every chunk within `reach` metres of the
 * stroke, in the order a rider at `fromM` meets them — the road ahead first,
 * nearest first, then what lies behind. The worker streams in this order, so
 * the first corridor is on screen before the far end is built.
 */
export function corridor(stroke: Stroke, reach: number, fromM = 0): Cell[] {
	// Each chunk takes the along of the road sample nearest its centre.
	const near = new Map<string, { cell: Cell; along: number; d: number }>();
	const p = stroke.points;
	const every = Math.max(1, Math.floor(CHUNK_M / 4 / STROKE_STEP_M));
	const span = Math.ceil(reach / CHUNK_M);
	for (let k = 0; k < p.length / 2; k += every) {
		const along = stroke.startM + k * STROKE_STEP_M;
		const c = chunkOf(p[2 * k], p[2 * k + 1]);
		for (let di = -span; di <= span; di++)
			for (let dj = -span; dj <= span; dj++) {
				const cell: Cell = { size: CHUNK_M, i: c.i + di, j: c.j + dj };
				const dx = (cell.i + 0.5) * CHUNK_M - p[2 * k];
				const dz = (cell.j + 0.5) * CHUNK_M - p[2 * k + 1];
				const d = dx * dx + dz * dz;
				const id = `${cell.i}:${cell.j}`;
				const was = near.get(id);
				if (!was || d < was.d) near.set(id, { cell, along, d });
			}
	}
	const ahead = (a: number) => (a >= fromM ? a - fromM : fromM - a + 1e9);
	return [...near.values()]
		.sort((a, b) => ahead(a.along) - ahead(b.along))
		.map((x) => x.cell);
}
