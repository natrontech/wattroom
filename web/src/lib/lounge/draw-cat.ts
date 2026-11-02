/**
 * The cat, wherever the clock has it (moments.ts): asleep, sitting up, or
 * hopping to its next place. A pet anyone in the channel gives wakes it on
 * every screen. Drawn as it sat on the sill, moved to where it is.
 */
import { LOUNGE as C } from '$lib/lounge/palette';
import { dot, rect, sprite, type Ctx } from '$lib/lounge/pixel';
import type { SceneInput } from '$lib/lounge/scene';

const Z = ['111', '010', '111'];
/** The sill spot the drawing below was made at. */
const AT_X = 236;
const Y = 108;

export function drawCat(g: Ctx, s: SceneInput) {
	const { x, y, pose, facing } = s.cat;
	g.save();
	g.translate(Math.round(x), Math.round(y - Y));
	if (facing < 0) g.scale(-1, 1);
	g.translate(-AT_X, 0);
	if (pose === 'walk') walking(g, s);
	else if (pose === 'sit' || s.catAwake) sitting(g, s);
	else asleep(g, s);
	g.restore();
}

function sitting(g: Ctx, s: SceneInput) {
	const flick = s.still ? 0 : Math.round(Math.sin(s.t * 6) * 1.5);
	rect(g, 232, Y - 12, 9, 12, C.cat);
	rect(g, 233, Y - 18, 8, 6, C.cat);
	dot(g, 233, Y - 19, C.cat);
	dot(g, 240, Y - 19, C.cat);
	dot(g, 235, Y - 16, C.amber);
	dot(g, 238, Y - 16, C.amber);
	rect(g, 241, Y - 3, 5, 2, C.catLight);
	rect(g, 245, Y - 7 + flick, 2, 5, C.catLight);
}

function asleep(g: Ctx, s: SceneInput) {
	rect(g, 230, Y - 5, 14, 5, C.cat);
	rect(g, 231, Y - 6, 12, 1, C.cat);
	rect(g, 240, Y - 8, 6, 5, C.cat);
	dot(g, 240, Y - 9, C.cat);
	dot(g, 245, Y - 9, C.cat);
	rect(g, 242, Y - 6, 2, 1, C.ink);
	rect(g, 226, Y - 2, 5, 2, C.catLight);
	if (s.still) return;
	for (const offset of [0, 1.2]) {
		const a = (s.t + offset) % 2.4;
		sprite(g, Z, Math.round(246 + a * 2), Math.round(Y - 11 - a * 4), C.lilac);
	}
}

function walking(g: Ctx, s: SceneInput) {
	const step = s.still ? 0 : Math.floor(s.t * 8) % 2;
	rect(g, 229, Y - 9, 13, 5, C.cat);
	rect(g, 240, Y - 13, 6, 5, C.cat);
	dot(g, 240, Y - 14, C.cat);
	dot(g, 245, Y - 14, C.cat);
	dot(g, 244, Y - 11, C.amber);
	for (const leg of [230, 239]) rect(g, leg + step * 2, Y - 4, 1, 4, C.cat);
	rect(g, 226, Y - 12, 1, 4, C.catLight);
	rect(g, 227, Y - 9, 2, 1, C.catLight);
}
