// What the world may cost a frame (#2998: never render at display rate next
// to LiveKit video, and never more pixels than the view needs).

export const FPS = 30;
const FRAME = 1 / FPS;
const SLACK = 0.004; // seconds of vsync jitter a frame may arrive early by

/**
 * Whether this animation frame renders, given the time banked since the last
 * render and this frame's delta (seconds). The remainder is kept rather than
 * reset, so 60 Hz renders every second frame exactly — resetting it is what
 * alternated 30 and 20 fps in the prototype.
 */
export function pace(
	banked: number,
	delta: number,
): { banked: number; render: boolean } {
	const t = banked + delta;
	if (t < FRAME - SLACK) return { banked: t, render: false };
	return { banked: Math.min(t - FRAME, FRAME), render: true };
}

export const PIXEL_BUDGET = 1.6e6;

/**
 * The renderer's pixel ratio for a canvas of w × h CSS pixels: the device's
 * own, unless that would draw more than the budget — stricter than a DPR
 * cap on a big window, and never below half resolution.
 */
export function pixelRatio(w: number, h: number, dpr: number): number {
	const area = Math.max(1, w * h);
	return Math.max(0.5, Math.min(dpr, Math.sqrt(PIXEL_BUDGET / area)));
}
