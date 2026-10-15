import { regionAt, type Keying } from '../place/region';
import { nearest, type StrokeIndex } from '../chunks/stroke-index';
import { smoothstep } from '../rand';
import type { Salt } from '../place/keyed';

/**
 * A spot's place in a private region (#3607, ADR-0081): the region's salt and
 * the spot's metres along and beside it from the region's origin, in the
 * region's own frame, and how much of the ground there is the region's.
 */
export type RegionPoint = { salt: Salt; u: number; v: number; w: number };
export type RegionAt = (e: number, n: number) => RegionPoint | null;

/** Metres of road inside a region's edge over which its ground fades in from the public one. */
export const BLEND_M = 60;
/** Beyond this from the served road the public ground is the whole of it; the full fade ends by 150, inside the index's guaranteed search. */
const NEAR_M = 80;
const FAR_M = 150;

/**
 * The region a key-frame spot lies by, found as a chunk's cells find it
 * (chunks/chunk.ts). Past the region's edge, or away from the road, `w` is 0,
 * so the two grounds meet without a step.
 * ponytail: one nearest-point search per relief sample, only where regions exist.
 */
export function regionPoints(keying: Keying, index: StrokeIndex): RegionAt {
	return (e, n) => {
		const at = nearest(index, e, n);
		if (!at) return null;
		const r = regionAt(keying, at.along);
		if (!r) return null;
		const w =
			smoothstep(0, BLEND_M, Math.min(at.along - r.fromM, r.toM - at.along)) *
			(1 - smoothstep(NEAR_M, FAR_M, at.dist));
		if (w <= 0) return null;
		return {
			salt: r.salt,
			u: (at.along - r.originM) * r.sign,
			v: at.offset * r.sign,
			w,
		};
	};
}
