/**
 * Where ADR-0046's slots dock around the world (#3031, ADR-0066): each one a
 * rectangle in fractions of the riding surface, for a desk and for TV at
 * 3 m. The middle of the screen is the road's — the keep-clear corridor
 * (docs/SPEC.md "The world": the middle 40 % of the width and 55 % of the
 * height) — and in it the rider box, where the chase camera draws you. The
 * jukebox seat (top right) is kept for the player, which is never overlaid
 * (RMF). Under a shared screen the world holds, the screen takes the stage
 * between the two columns, and the horizon shrinks to a 40 px strip.
 */

export type Box = { x0: number; y0: number; x1: number; y1: number };
export type Dock =
	'header' | 'status' | 'focus' | 'numbers' | 'crew' | 'horizon';
export type Layout = 'desk' | 'tv';

export const CORRIDOR: Box = { x0: 0.3, y0: 0.225, x1: 0.7, y1: 0.775 };
/** #3031's acceptance: where the chase camera puts the rider. */
export const RIDER_BOX: Box = { x0: 0.4, y0: 0.55, x1: 0.6, y1: 0.82 };
export const JUKEBOX_SEAT: Box = { x0: 0.74, y0: 0.02, x1: 0.98, y1: 0.3 };

// The header keeps to the band above the road; the ride's controls and its
// status stand in the left column under it ('status'), your numbers below
// them. What has the focus — a sprint, a game — takes the right column, which
// the crew holds otherwise: they take turns, since a sprint quiets the crew
// and a game's panel lists everyone itself.
// prettier-ignore
export const DOCKS: Record<Layout, Record<Dock, Box>> = {
	desk: {
		header: { x0: 0.02, y0: 0.02, x1: 0.72, y1: 0.22 },
		status: { x0: 0.02, y0: 0.23, x1: 0.29, y1: 0.58 },
		focus: { x0: 0.72, y0: 0.32, x1: 0.98, y1: 0.84 },
		numbers: { x0: 0.02, y0: 0.6, x1: 0.29, y1: 0.84 },
		crew: { x0: 0.72, y0: 0.32, x1: 0.98, y1: 0.84 },
		horizon: { x0: 0.02, y0: 0.86, x1: 0.98, y1: 0.98 },
	},
	// Three metres away the band is taller and the columns narrower.
	tv: {
		header: { x0: 0.02, y0: 0.02, x1: 0.72, y1: 0.22 },
		status: { x0: 0.02, y0: 0.23, x1: 0.28, y1: 0.56 },
		focus: { x0: 0.74, y0: 0.32, x1: 0.98, y1: 0.86 },
		numbers: { x0: 0.02, y0: 0.58, x1: 0.28, y1: 0.86 },
		crew: { x0: 0.74, y0: 0.32, x1: 0.98, y1: 0.86 },
		horizon: { x0: 0.02, y0: 0.88, x1: 0.98, y1: 0.98 },
	},
};

/** Docks that share a place because they are never drawn together. */
export const TAKE_TURNS: readonly Dock[] = ['focus', 'crew'];

/** A shared screen's stage, between the columns, over the paused world. */
export const STAGE: Box = { x0: 0.3, y0: 0.23, x1: 0.71, y1: 0.84 };
export const STRIP_PX = 40;

export const meets = (a: Box, b: Box): boolean =>
	a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** A box as absolute CSS within the surface. */
export const place = (b: Box): string =>
	`left:${b.x0 * 100}%;top:${b.y0 * 100}%;width:${(b.x1 - b.x0) * 100}%;height:${(b.y1 - b.y0) * 100}%`;
