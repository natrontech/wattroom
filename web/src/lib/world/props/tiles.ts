import { crowd } from '../placement/check';
import { o5 } from '../placement/rules';
import type { Placement } from '../placement/types';
import type { Origin } from '../terrain/ground';

/**
 * The tile a place stands its things by (#3699): 250 m of the key frame, the
 * draw's tile too (batch.ts). A tile's candidates come from its own cells,
 * slots and villages; which of them stand is settled against its own and its
 * eight neighbours' candidates by rank, never by the order tiles were asked
 * in, so the props a rider meets stream with the ground and a place stands
 * the same things whichever way it was reached (#3226).
 */
export const TILE_M = 250;

/** What a tile might stand: its placement, how it ranks against what it would touch, and what it is if it stands. */
export type Candidate<T> = { p: Placement; rank: number; is: T };

/**
 * Ranks, highest first: set pieces were stood before the props and still
 * win their spot, a church its village's, a house a barn's, and so on down
 * to a tree. A keyed unit under 1 breaks ties within a class.
 */
export const RANK = {
	piece: 6,
	church: 5,
	house: 4,
	farm: 3,
	rock: 2,
	herd: 1,
	tree: 0,
} as const;

export const tileKey = (ti: number, tj: number) => `${ti}:${tj}`;

/** The tile (x, z) stands in. */
export function tileOf(
	x: number,
	z: number,
	[e0, n0]: Origin = [0, 0],
): [number, number] {
	return [Math.floor((e0 + x) / TILE_M), Math.floor((n0 - z) / TILE_M)];
}

/** A tile's centre, local x and z. */
export function tileCentre(
	ti: number,
	tj: number,
	[e0, n0]: Origin = [0, 0],
): [number, number] {
	return [(ti + 0.5) * TILE_M - e0, n0 - (tj + 0.5) * TILE_M];
}

/**
 * Which of `own` stand: each unless a candidate of higher rank in `around`
 * (its own tile's and its neighbours') would touch it. Two ranks never tie:
 * the name breaks what the keyed unit does not.
 */
export function settle<T>(
	own: readonly Candidate<T>[],
	around: readonly Candidate<T>[],
): Candidate<T>[] {
	const near = crowd();
	const rankOf = new Map<Placement, number>();
	for (const c of around) {
		near.add(c.p);
		rankOf.set(c.p, c.rank);
	}
	const above = (q: Placement, c: Candidate<T>) => {
		const r = rankOf.get(q)!;
		return r > c.rank || (r === c.rank && q.id > c.p.id);
	};
	return own.filter(
		(c) =>
			!near
				.near(c.p)
				.some((q) => q !== c.p && above(q, c) && o5(c.p, q).length > 0),
	);
}
