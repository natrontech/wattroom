/**
 * How big the lounge's pixel is in a box of w × h page pixels (#4537): the
 * biggest that shows the whole room, its front row and the names under it
 * included, above the room's bar, letterboxed by more room either side
 * rather than cropped. In whole pixels of the screen, so a room pixel is
 * always the same number of screen pixels and the art stays crisp.
 */
import { FRONT_Y, SAFE_W, SCENE_H, middleOf } from '#lib/lounge/scene.ts';

/** The biggest room pixel, in page pixels. */
const MOST = 6;
/** The lowest name in the front row: its top row, under the bar's stools and the arcade. */
const LAST_NAME = FRONT_Y + 18;
/** A name tag's height in page pixels at room pixel s: its type grows at 3 and 4 (LoungeScene's tags). */
export const namePx = (s: number) => (s >= 4 ? 16 : s >= 3 ? 14 : 13);

/** Whether h page pixels at room pixel s show the whole room above a bar of bar page pixels. */
export function wholeAt(h: number, s: number, bar: number): boolean {
	const rows = Math.floor(h / s);
	const { oy } = middleOf(SAFE_W, rows);
	return (rows - oy - LAST_NAME) * s >= namePx(s) + bar;
}

/** Whether h page pixels at room pixel s show the stage above the bar: all a picture on the wall leaves. */
export function stageAt(h: number, s: number, bar: number): boolean {
	return Math.floor(h / s) >= SCENE_H + Math.ceil(bar / s);
}

/**
 * The room pixel, in page pixels, for a box of w × h on a screen of dpr
 * screen pixels to the page pixel, with the room's bar bar page pixels
 * tall. `whole` asks for the whole room; otherwise the stage is enough (a
 * picture on the wall, which takes the front row). A phone, which shows
 * the stage at no more than 1, gets 2 when its height allows, and pans
 * the rest. Where not even 1 shows the whole room, the stage alone decides.
 */
export function fitOf(
	w: number,
	h: number,
	dpr: number,
	bar: number,
	whole = true,
): number {
	const tall = (s: number) => (whole ? wholeAt : stageAt)(h, s, bar);
	const lowest = Math.max(1, Math.round(dpr));
	let best = 0;
	for (let k = Math.floor(MOST * dpr); k >= lowest; k--) {
		const s = k / dpr;
		if (w / s >= SAFE_W && tall(s)) {
			best = s;
			break;
		}
	}
	const phone = Math.round(2 * dpr) / dpr;
	if (best <= 1 && tall(phone)) return phone;
	if (best) return best;
	return whole ? fitOf(w, h, dpr, bar, false) : lowest / dpr;
}
