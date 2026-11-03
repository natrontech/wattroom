/**
 * The disco ball, down from the ceiling while house radio is in a drop. Its
 * light is a few small spots drifting over the walls, never a change in the
 * room's brightness: nothing here can flash the view (WCAG 2.3.1).
 */
import { LOUNGE as C } from '$lib/lounge/palette';
import { disc, dot, rect, type Ctx } from '$lib/lounge/pixel';
import type { SceneInput } from '$lib/lounge/scene';
import { hash3 } from '$lib/lounge/hash';

const SPOTS = 18;

export function drawDisco(g: Ctx, s: SceneInput) {
	if (!s.disco) return;
	const cx = Math.floor(s.w / 2);
	rect(g, cx, 0, 1, 12, C.cable);
	disc(g, cx, 16, 5, C.ink);
	disc(g, cx, 16, 4, C.lilac);
	// Facets catch the light in turn.
	const turn = s.still ? 0 : Math.floor(s.t * 3);
	for (let fy = -3; fy <= 3; fy += 2)
		for (let fx = -3; fx <= 3; fx += 2)
			if (fx * fx + fy * fy <= 13 && (fx + fy + turn) % 4 === 0)
				dot(g, cx + fx, 16 + fy, C.paper);
	const hues = [C.tealLight, C.heart, C.bulb, C.paper];
	for (let i = 0; i < SPOTS; i++) {
		const drift = s.still
			? 0
			: s.t * (4 + hash3(i, 3, 5) * 5) * (i % 2 ? 1 : -1);
		const x = (((hash3(i, 1, 5) * s.w + drift) % s.w) + s.w) % s.w;
		const y = 24 + hash3(i, 2, 5) * (s.h - 32);
		rect(g, x, y, 2, 2, hues[i % hues.length]);
	}
}
