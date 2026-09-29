import { cm, keyed, type Kind, type Salt } from './keyed';
import { cellOf, FINE_M, type CellSize } from './lattice';
import { STROKE_STEP_M, strokeMetre, type Stroke } from './stroke';

/**
 * Which salt, and which cells, a decision is keyed in (#3224).
 *
 * Outside a private region: the road's salt (#3225), in the world lattice at
 * the spot's key-frame position. Inside one — a hidden end now, a zone once
 * #3132 ships — the region's own owner-only salt, in cells of the region's
 * own frame: metres along the stroke from where the region starts, metres
 * beside it. No world coordinate is computed there and no stroke vertex is
 * read, for anyone including the owner, so a photo from a start line at home
 * matches no place.
 */

export type Region = {
	/** Metres along the stroke. */
	fromM: number;
	toM: number;
	salt: Salt;
	/** The region's own frame: its origin on the stroke, and ±1 as the served road runs along it. */
	originM: number;
	sign: 1 | -1;
};

/**
 * A region the server names on the road as it serves it (#3225), placed on
 * the stroke. Its frame runs the way the served road does, so its cells stay
 * put whichever way the stroke happens to run.
 */
export function onStroke(
	stroke: Stroke,
	served: { fromM: number; toM: number; salt: Salt },
): Region {
	const a = strokeMetre(stroke, served.fromM);
	const b = strokeMetre(stroke, served.toM);
	return {
		fromM: Math.min(a, b),
		toM: Math.max(a, b),
		salt: served.salt,
		originM: a,
		sign: stroke.reversed ? -1 : 1,
	};
}

export type Keying = {
	stroke: Stroke;
	/** The road's salt now; the world's once ADR-0081 is accepted. */
	salt: Salt;
	regions: readonly Region[];
};

/** A spot `offset` metres right of the stroke at `along`, in the key frame. */
export function besideStroke(
	stroke: Stroke,
	along: number,
	offset: number,
): [number, number] {
	const p = stroke.points;
	const last = p.length / 2 - 1;
	const at = Math.min(Math.max(along - stroke.startM, 0) / STROKE_STEP_M, last);
	const k = Math.min(Math.floor(at), last - 1);
	const f = at - k;
	const dx = p[2 * k + 2] - p[2 * k];
	const dz = p[2 * k + 3] - p[2 * k + 1];
	const len = Math.sqrt(dx * dx + dz * dz);
	// Right of travel in a frame with z south is (-dz, dx).
	return [
		p[2 * k] + dx * f - (dz / len) * offset,
		p[2 * k + 1] + dz * f + (dx / len) * offset,
	];
}

export function regionAt(keying: Keying, along: number): Region | undefined {
	// Closed at both ends: a region's edge is the same spot whichever way the stroke runs.
	return keying.regions.find((r) => along >= r.fromM && along <= r.toM);
}

/** The key for a `kind` decision about the `size` cell at a spot beside the stroke. */
export function keyAt(
	keying: Keying,
	kind: Kind,
	along: number,
	offset: number,
	size: CellSize,
): number {
	const side = size * 100;
	const region = regionAt(keying, along);
	if (region)
		return keyed(
			region.salt,
			kind,
			Math.floor(cm((along - region.originM) * region.sign) / side),
			Math.floor(cm(offset * region.sign) / side),
		);
	const [x, z] = besideStroke(keying.stroke, along, offset);
	const cell = cellOf(x, z, size);
	return keyed(keying.salt, kind, cell.i, cell.j);
}

/**
 * A digest of every fine cell's tree decision within `reach` metres either
 * side of the stroke, from `fromM` to `toM`: what two clients compare to know
 * they built one world.
 */
export function placementHash(
	keying: Keying,
	fromM: number,
	toM: number,
	reach: number,
): string {
	let h = 0x811c9dc5;
	for (let along = fromM; along < toM; along += FINE_M)
		for (let offset = -reach; offset <= reach; offset += FINE_M) {
			h ^= keyAt(keying, 'tree', along, offset, FINE_M);
			h = Math.imul(h, 0x01000193);
		}
	return (h >>> 0).toString(16).padStart(8, '0');
}
