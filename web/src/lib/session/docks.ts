/**
 * Where ADR-0046's slots dock around the world (#3031, ADR-0066, #3668). The
 * middle of the screen is the road's — the keep-clear corridor (docs/SPEC.md
 * "The world": the middle 40 % of the width and 55 % of the height) — and in
 * it the rider box, where the chase camera draws you. The jukebox seat (top
 * right) is kept for the player, which is never overlaid (RMF).
 *
 * A dock is an anchor, not a box (#3668): a corner or an edge, inset 16 px,
 * and the most it may take; its panel is its content's size. Slot 1 hangs
 * from the top left and stops short of the seat, your numbers stand on the
 * Skyline at the left edge, the crew and what has the focus hang under the
 * seat, and the Skyline runs along the bottom. TARGETS.md's ride-road-world
 * box table is what these hold at 1440 × 900 and 1920 × 1080.
 */

export type Box = { x0: number; y0: number; x1: number; y1: number };

export const CORRIDOR: Box = { x0: 0.3, y0: 0.225, x1: 0.7, y1: 0.775 };
/** #3031's acceptance: where the chase camera puts the rider. */
export const RIDER_BOX: Box = { x0: 0.4, y0: 0.55, x1: 0.6, y1: 0.82 };
export const JUKEBOX_SEAT: Box = { x0: 0.74, y0: 0.02, x1: 0.98, y1: 0.3 };

/** A panel's inset from the canvas edge, and the gap between two (TARGETS G3). */
export const INSET_PX = 16;
export const GAP_PX = 12;
/** A side panel's widest: against its edge, clear of the corridor (G3). */
export const SIDE_MAX = CORRIDOR.x0;
/** The Skyline's height along the bottom (TARGETS ride-road-world 11: over 56 px). */
export const SKYLINE_PX = 64;
/**
 * The moment card's narrowest at SPEC's 24 px words (Jan, 2026-10-06, #3668):
 * top-centre while this much is free between slot 1 and the seat, otherwise
 * under the seat.
 */
export const MOMENT_MIN_PX = 300;

/**
 * The shortest canvas the box table holds at SPEC's sizes: slot 1's band
 * (176), the computer (508) and the Skyline (64), with their insets and
 * gaps. A shorter window rides the flat surface and says why (Jan,
 * 2026-10-07, #3668). ponytail: a constant from the box table; measure the
 * stack itself if the computer's pages ever grow.
 */
export const WORLD_MIN_PX = 820;

/** A shared screen's stage, between the columns, over the paused world. */
export const STAGE: Box = { x0: 0.3, y0: 0.23, x1: 0.71, y1: 0.84 };
export const STRIP_PX = 40;

export const meets = (a: Box, b: Box): boolean =>
	a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** A box as absolute CSS within the surface. */
export const place = (b: Box): string =>
	`left:${b.x0 * 100}%;top:${b.y0 * 100}%;width:${(b.x1 - b.x0) * 100}%;height:${(b.y1 - b.y0) * 100}%`;

/**
 * Where the moment card goes on a canvas `width` px wide whose slot 1 ends
 * `slotRight` px from its left edge: top-centre when it fits between slot 1
 * and the seat, gaps included, otherwise under the seat (D12).
 */
export function momentAt(width: number, slotRight: number): 'top' | 'seat' {
	const free = JUKEBOX_SEAT.x0 * width - slotRight - 2 * GAP_PX;
	return free >= MOMENT_MIN_PX ? 'top' : 'seat';
}
