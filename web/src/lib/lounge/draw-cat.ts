/**
 * The cat, wherever the clock has it (moments.ts): asleep, sitting up,
 * walking to its next place or jumping on and off the furniture. A pet anyone in the channel gives wakes it on
 * every screen. Drawn as it sat on the sill, moved to where it is.
 */
import { LOUNGE as C } from '$lib/lounge/palette';
import { dot, outlined, rect, sprite, type Ctx } from '$lib/lounge/pixel';
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
	if (pose === 'walk') walking(g, s, s.cat.stride);
	else if (pose === 'leap') leaping(g);
	else if (pose === 'sit' || s.catAwake) sitting(g, s);
	else asleep(g, s);
	g.restore();
}

function sitting(g: Ctx, s: SceneInput) {
	const flick = s.still ? 0 : Math.round(Math.sin(s.t * 6) * 1.5);
	outlined(
		g,
		[
			[232, Y - 12, 9, 12, C.cat],
			[233, Y - 18, 8, 6, C.cat],
			[233, Y - 19, 1, 1, C.cat],
			[240, Y - 19, 1, 1, C.cat],
			[241, Y - 3, 5, 2, C.catLight],
			[245, Y - 7 + flick, 2, 5, C.catLight],
		],
		C.ink,
	);
	dot(g, 235, Y - 16, C.amber);
	dot(g, 238, Y - 16, C.amber);
}

function asleep(g: Ctx, s: SceneInput) {
	outlined(
		g,
		[
			[230, Y - 5, 14, 5, C.cat],
			[231, Y - 6, 12, 1, C.cat],
			[240, Y - 8, 6, 5, C.cat],
			[240, Y - 9, 1, 1, C.cat],
			[245, Y - 9, 1, 1, C.cat],
			[226, Y - 2, 5, 2, C.catLight],
		],
		C.ink,
	);
	rect(g, 242, Y - 6, 2, 1, C.ink);
	if (s.still) return;
	for (const offset of [0, 1.2]) {
		const a = (s.t + offset) % 2.4;
		sprite(g, Z, Math.round(246 + a * 2), Math.round(Y - 11 - a * 4), C.lilac);
	}
}

/**
 * Two frames, legs apart and legs together, one for every three pixels
 * walked: the body rides a pixel higher over gathered legs.
 */
function walking(g: Ctx, s: SceneInput, stride: number) {
	const together = !s.still && Math.floor(stride / 3) % 2 === 1;
	const up = together ? 1 : 0;
	const legs = together ? [231, 233, 238, 240] : [230, 234, 237, 241];
	outlined(
		g,
		[
			[229, Y - 9 - up, 13, 5, C.cat],
			[240, Y - 13 - up, 6, 5, C.cat],
			[240, Y - 14 - up, 1, 1, C.cat],
			[245, Y - 14 - up, 1, 1, C.cat],
			...legs.map((x) => [x, Y - 4 - up, 1, 4 + up, C.cat] as const),
			[226, Y - 13 - up, 1, 4, C.catLight],
			[227, Y - 10 - up, 2, 1, C.catLight],
		],
		C.ink,
	);
	dot(g, 244, Y - 11 - up, C.amber);
}

/** Mid-jump: stretched out, forelegs reaching down ahead, hind legs pushing off behind. */
function leaping(g: Ctx) {
	outlined(
		g,
		[
			[229, Y - 11, 12, 4, C.cat],
			[240, Y - 14, 6, 5, C.cat],
			[240, Y - 15, 1, 1, C.cat],
			[245, Y - 15, 1, 1, C.cat],
			[242, Y - 7, 1, 2, C.cat],
			[243, Y - 5, 1, 2, C.cat],
			[228, Y - 8, 1, 2, C.cat],
			[227, Y - 6, 1, 2, C.cat],
			[224, Y - 11, 5, 1, C.catLight],
			[223, Y - 13, 1, 2, C.catLight],
		],
		C.ink,
	);
	dot(g, 244, Y - 12, C.amber);
}
