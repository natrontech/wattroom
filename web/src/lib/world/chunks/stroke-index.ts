import { CHUNK_M } from '../place/lattice';
import { STROKE_STEP_M, type Stroke } from '../place/stroke';

/**
 * Where a spot is along a stroke (#3074): the nearest point of the stroke's
 * line, as metres along it and metres to its right. The vertices are
 * bucketed by chunk once, so a chunk's cells search only their neighbours.
 */
export type Along = { along: number; offset: number; dist: number };
export type StrokeIndex = { stroke: Stroke; buckets: Map<string, number[]> };

const bucketOf = (x: number, z: number) =>
	`${Math.floor(x / CHUNK_M)}:${Math.floor(z / CHUNK_M)}`;

export function indexStroke(stroke: Stroke): StrokeIndex {
	const buckets = new Map<string, number[]>();
	const p = stroke.points;
	for (let k = 0; k < p.length / 2 - 1; k++) {
		// A segment goes in the bucket of each end: 2 m never spans more than two.
		for (const q of [k, k + 1]) {
			const b = bucketOf(p[2 * q], p[2 * q + 1]);
			const list = buckets.get(b) ?? [];
			if (list.at(-1) !== k) list.push(k);
			buckets.set(b, list);
		}
	}
	return { stroke, buckets };
}

/**
 * The nearest point of the stroke to (x, z), searching outward ring by ring
 * until no farther ring could hold a closer one; null when the stroke is more
 * than `rings` chunks away.
 */
export function nearest(
	index: StrokeIndex,
	x: number,
	z: number,
	rings = 2,
): Along | null {
	const p = index.stroke.points;
	const bi = Math.floor(x / CHUNK_M);
	const bj = Math.floor(z / CHUNK_M);
	let best: Along | null = null;
	// Once rings 0 … r−1 are searched, anything farther out is at least r−1 chunks away.
	for (let r = 0; r <= rings && !(best && best.dist <= (r - 1) * CHUNK_M); r++)
		for (let di = -r; di <= r; di++)
			for (let dj = -r; dj <= r; dj++) {
				if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
				for (const k of index.buckets.get(`${bi + di}:${bj + dj}`) ?? []) {
					const ax = p[2 * k];
					const az = p[2 * k + 1];
					const dx = p[2 * k + 2] - ax;
					const dz = p[2 * k + 3] - az;
					const len2 = dx * dx + dz * dz || 1;
					const t = Math.min(
						Math.max(((x - ax) * dx + (z - az) * dz) / len2, 0),
						1,
					);
					const ex = x - ax - t * dx;
					const ez = z - az - t * dz;
					const dist = Math.sqrt(ex * ex + ez * ez);
					if (best && dist >= best.dist) continue;
					const len = Math.sqrt(len2);
					best = {
						along: index.stroke.startM + k * STROKE_STEP_M + t * len,
						// Right of travel is (−dz, dx), as besideStroke has it.
						offset: ((x - ax) * -dz + (z - az) * dx) / len,
						dist,
					};
				}
			}
	return best;
}
