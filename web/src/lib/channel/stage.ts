/**
 * The stage's two bits of arithmetic (#280), kept pure so they are testable
 * without LiveKit or a DOM: which source is on stage, and where the picture
 * sits once you have zoomed into it.
 */
export interface StageSource {
	key: string;
	kind: 'screen' | 'cam' | 'jukebox';
}

/**
 * Your pick if it is still live, else the jukebox video, else the newest
 * share, else nothing. The video leads: it is the thing the whole room is
 * watching together, and it must never end up as a window pasted over the
 * cam grid (#316). Cameras never claim the stage on their own — the rider
 * tiles already show them, and a face jumping onto the big surface when a
 * share ends is a surprise, not a feature.
 */
export function pickStage<T extends StageSource>(
	sources: T[],
	pick: string | null,
): T | null {
	return (
		sources.find((source) => source.key === pick) ??
		sources.find((source) => source.kind === 'jukebox') ??
		sources.findLast((source) => source.kind === 'screen') ??
		null
	);
}

/**
 * What the chip under the stage calls a source. Yours is named as yours
 * (#563): "Sven's screen" among five other names does not read as *your*
 * desktop on the shared surface, which is the one case where being wrong
 * about whose screen it is leaks something.
 */
export function sourceLabel(
	kind: 'screen' | 'cam',
	name: string | undefined,
	you = false,
): string {
	if (you) return kind === 'screen' ? 'Your screen' : 'You';
	const who = name || 'someone';
	return kind === 'screen' ? `${who}'s screen` : who;
}

/**
 * Which picture the stage is showing: the source plus the generation of its
 * track. Zoom belongs to a picture, so this is what the stage resets to fit
 * on — another source, or the same sharer's screen back on a fresh track
 * (#523). Nothing else may reset it: the room rebuilds the source objects on
 * every tick, and a reset keyed on those pulled a reading rider back to 1x
 * half a second after they zoomed in.
 */
export function pictureKey(source: { key: string; gen: string | number }) {
	return `${source.key}:${source.gen}`;
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
