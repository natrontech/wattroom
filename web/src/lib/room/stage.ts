import type { StageSource } from '$lib/room/av.svelte';

/**
 * The stage's pure half (#280): what belongs on the big surface, and how the
 * picture sits in a frame you can zoom and pan. Kept out of the component so
 * the geometry — which is easy to get subtly wrong and impossible to eyeball
 * — has tests.
 */

/**
 * What to show. A pick that has ended — they stopped sharing, they turned
 * their camera off — falls back to the newest live share rather than
 * blanking, which is the rule #219 pinned for the projector, now with
 * somewhere to fall back TO.
 */
export function stageOf(
	pick: StageSource | null,
	screens: string[],
	cameras: string[],
): StageSource | null {
	if (pick?.kind === 'screen' && screens.includes(pick.id)) return pick;
	if (pick?.kind === 'camera' && cameras.includes(pick.id)) return pick;
	const newest = screens[screens.length - 1];
	return newest ? { kind: 'screen', id: newest } : null;
}

export interface View {
	zoom: number;
	tx: number;
	ty: number;
}
export interface Size {
	width: number;
	height: number;
}

export const MAX_ZOOM = 8;

/** Keep the picture covering the frame — it can never be dragged off. */
export function clampPan(view: View, frame: Size): View {
	return {
		zoom: view.zoom,
		tx: Math.min(0, Math.max(frame.width * (1 - view.zoom), view.tx)),
		ty: Math.min(0, Math.max(frame.height * (1 - view.zoom), view.ty)),
	};
}

/**
 * Zoom by `factor` about (cx, cy) in frame coordinates, holding the point
 * under the cursor still — which is what makes a zoom feel like a magnifier
 * instead of a jump.
 */
export function zoomAt(
	view: View,
	cx: number,
	cy: number,
	factor: number,
	frame: Size,
): View {
	const zoom = Math.min(MAX_ZOOM, Math.max(1, view.zoom * factor));
	const ratio = zoom / view.zoom;
	return clampPan(
		{
			zoom,
			tx: cx - (cx - view.tx) * ratio,
			ty: cy - (cy - view.ty) * ratio,
		},
		frame,
	);
}
