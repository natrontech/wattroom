/**
 * The stage's two bits of arithmetic (#280), kept pure so they are testable
 * without LiveKit or a DOM: which source is on stage, and where the picture
 * sits once you have zoomed into it.
 */
export interface StageSource {
	key: string;
	kind: 'screen' | 'cam';
}

/**
 * Your pick if it is still live, else the newest share, else nothing.
 * Cameras never claim the stage on their own — the rider tiles already show
 * them, and a face jumping onto the big surface when a share ends is a
 * surprise, not a feature.
 */
export function pickStage<T extends StageSource>(
	sources: T[],
	pick: string | null,
): T | null {
	return (
		sources.find((source) => source.key === pick) ??
		sources.findLast((source) => source.kind === 'screen') ??
		null
	);
}

/** Pan offset and scale of the picture inside the frame; origin = centre. */
export interface StageView {
	zoom: number;
	x: number;
	y: number;
}

export const MAX_ZOOM = 8;
export const FIT: StageView = { zoom: 1, x: 0, y: 0 };

/** Past the edge there is only background — pan stops at the overflow. */
function clampPan(view: StageView, w: number, h: number): StageView {
	const maxX = (w * (view.zoom - 1)) / 2;
	const maxY = (h * (view.zoom - 1)) / 2;
	return {
		zoom: view.zoom,
		x: Math.min(maxX, Math.max(-maxX, view.x)),
		y: Math.min(maxY, Math.max(-maxY, view.y)),
	};
}

/**
 * Scale to `zoom`, keeping the point (atX, atY) — frame coordinates from the
 * centre — under the cursor. Zooming about the centre instead would walk the
 * thing you are trying to read straight off the frame.
 */
export function zoomAbout(
	view: StageView,
	zoom: number,
	atX: number,
	atY: number,
	w: number,
	h: number,
): StageView {
	const next = Math.min(MAX_ZOOM, Math.max(1, zoom));
	const k = next / view.zoom;
	return clampPan(
		{ zoom: next, x: atX - k * (atX - view.x), y: atY - k * (atY - view.y) },
		w,
		h,
	);
}

export function panBy(
	view: StageView,
	dx: number,
	dy: number,
	w: number,
	h: number,
): StageView {
	return clampPan({ zoom: view.zoom, x: view.x + dx, y: view.y + dy }, w, h);
}
