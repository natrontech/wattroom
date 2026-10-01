// What the world may cost a frame in pixels (#2998, #3078): never more than
// the view needs, and never more than docs/SPEC.md's budget. The frame rate
// is loop.ts's.

/** About 1.0 MP a frame (docs/SPEC.md, "The world"). */
export const PIXEL_BUDGET = 1e6;

/**
 * The renderer's pixel ratio for a canvas of w × h CSS pixels: the device's
 * own, unless that would draw more than the budget. No floor: a big window
 * draws below one pixel per CSS pixel and the browser scales it up.
 */
export function pixelRatio(w: number, h: number, dpr: number): number {
	return Math.min(dpr, Math.sqrt(PIXEL_BUDGET / Math.max(1, w * h)));
}
