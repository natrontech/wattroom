// What the world may cost a frame in pixels (#2998, #3078): never more than
// the view needs, and never more than docs/SPEC.md's budget, unless that
// would draw under one pixel per CSS pixel (#4256). The frame rate is
// loop.ts's.

/** Light draws half of it (#3214) above the floor; there is no lower tier yet. */
export const LIGHT_PIXEL_BUDGET = 5e5;

/** About 1.0 MP a frame (docs/SPEC.md, "The world"). */
export const PIXEL_BUDGET = 1e6;

/**
 * The renderer's pixel ratio for a canvas of w × h CSS pixels: the device's
 * own, unless that would draw more than the budget. Never under one pixel
 * per CSS pixel, or the device's own ratio where that is lower: a big desk
 * window draws more than the budget rather than a frame the browser scales
 * up, which blurs every edge.
 */
export function pixelRatio(
	w: number,
	h: number,
	dpr: number,
	budget = PIXEL_BUDGET,
): number {
	return Math.min(dpr, Math.max(1, Math.sqrt(budget / Math.max(1, w * h))));
}
