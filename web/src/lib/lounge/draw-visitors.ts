/**
 * The album's rare visitors, as small sprites at the people's scale: most
 * pass the window, the snail takes the sill, the hedgehog and the mouse cross
 * the floor. Each sprite is rows of letters, a letter a colour and a dot
 * nothing, so the album can draw them too.
 */
import { LOUNGE as C } from '$lib/lounge/palette';
import { rect, type Ctx } from '$lib/lounge/pixel';
import type { SceneInput } from '$lib/lounge/scene';
import type { Visitor } from '$lib/lounge/moments';
import { WINDOW } from '$lib/lounge/draw-window';

export const VISITOR_SPRITES: Record<Visitor, readonly string[]> = {
	fox: [
		'..o.o........',
		'..ooo........',
		'.kowo.ooooo..',
		'wwoooooooooow',
		'...ooooooooww',
		'...o.o..o.o..',
		'...k.k..k.k..',
	],
	cow: [
		'w.w...........',
		'wwww.wwwkkwww.',
		'kwkwwwwkkkwwwk',
		'wwwwwwwwwwwwww',
		'ppwwkkwwwwwww.',
		'ppwwkkwwpwww..',
		'.w.w.....w.w..',
		'.k.k.....k.k..',
	],
	star: ['w........', '.wl......', '...wl....', '.....wla.'],
	rainbow: [
		'...rrrrr...',
		'.rraaaaarr.',
		'rraatttaarr',
		'raattlttaar',
		'rat.....tar',
		'ra.......ar',
	],
	snail: ['..bbb...', '.boobb..', '.bobob.k', 'obbbb..o', 'oooooooo'],
	hedgehog: [
		'..kbkbkb..',
		'.bkbkbkbk.',
		'wbbkbkbkbk',
		'kwwbbbbbb.',
		'..k....k..',
	],
	mouse: ['.gg.....', 'kgggggg.', '..k.k..l'],
	ibex: [
		'b.b.......',
		'.bb.......',
		'..bb......',
		'..kbb.....',
		'..bbbbbbb.',
		'...bbbbbbb',
		'...bbbbbb.',
		'...b.b.b.b',
		'...k.k.k.k',
	],
	sleigh: [
		'.b.b.........w..',
		'..bb........rrr.',
		'.bbbbb.....rrrr.',
		'..bbbbbb..arrrr.',
		'..b..b.k.kaaaaa.',
		'.......kkkkkkkk.',
	],
	bat: ['k.......k', 'kk.k.k.kk', 'kkkkkkkkk', '.k.kkk.k.'],
	drone: [
		'ggg.....ggg',
		'..k.....k..',
		'..kkkkkkk..',
		'....kkk....',
		'....bbb....',
		'....bbb....',
	],
	marmot: [
		'..bbb..',
		'.bkbkb.',
		'.bbwbb.',
		'..bbb..',
		'.bbbbb.',
		'.bbobb.',
		'.bbobb.',
		'.b...b.',
	],
};

const COLOUR = (): Record<string, string> => ({
	a: C.amber,
	b: C.wood,
	g: C.cable,
	k: C.ink,
	l: C.lilac,
	o: C.amberDark,
	p: C.heart,
	r: C.redLight,
	t: C.teal,
	w: C.paper,
});

/** A sprite at x, y; `flip` faces it the other way; `ink` draws its silhouette. */
export function drawSprite(
	g: Ctx,
	kind: Visitor,
	x: number,
	y: number,
	flip = false,
	ink?: string,
) {
	const rows = VISITOR_SPRITES[kind];
	const colour = COLOUR();
	rows.forEach((row, j) => {
		for (let i = 0; i < row.length; i++) {
			const c = row[flip ? row.length - 1 - i : i];
			if (c !== '.') rect(g, x + i, y + j, 1, 1, ink ?? colour[c]);
		}
	});
}

/** Whether a visitor walks across the window, and which way. */
const WINDOW_WALKERS: Visitor[] = ['fox', 'cow', 'ibex'];
const WINDOW_FLYERS: Visitor[] = ['sleigh', 'bat', 'drone'];

export function drawWindowVisitor(g: Ctx, s: SceneInput) {
	const v = s.visitor;
	if (!v) return;
	const { X, Y, W, H } = WINDOW;
	const size = VISITOR_SPRITES[v.kind];
	const wide = size[0].length;
	const across = Math.round(X - wide + v.f * (W + wide));
	const ground = Y + 30;
	if (WINDOW_WALKERS.includes(v.kind)) {
		drawSprite(g, v.kind, across, ground - size.length + 2);
	} else if (WINDOW_FLYERS.includes(v.kind)) {
		const bob = s.still ? 0 : Math.round(Math.sin(s.t * 3) * 2);
		drawSprite(g, v.kind, X + W - (across - X) - wide, Y + 8 + bob, true);
	} else if (v.kind === 'star') {
		if (v.f < 0.2)
			drawSprite(g, 'star', X + 16 + Math.round(v.f * 200), Y + 4 + v.f * 40);
	} else if (v.kind === 'rainbow') {
		drawSprite(g, 'rainbow', X + W - 28, Y + 12);
	} else if (v.kind === 'marmot') {
		// Up from behind the sill, a look round, and down again.
		const up = Math.round(Math.sin(v.f * Math.PI) * 9);
		drawSprite(g, 'marmot', X + 12, Y + H - up);
	}
}

export function drawSillVisitor(g: Ctx, s: SceneInput) {
	if (s.visitor?.kind !== 'snail') return;
	const { X, Y, W, H } = WINDOW;
	drawSprite(g, 'snail', X + Math.round(s.visitor.f * (W - 8)), Y + H - 3);
}

export function drawFloorVisitor(g: Ctx, s: SceneInput) {
	const v = s.visitor;
	if (v?.kind === 'hedgehog') drawSprite(g, v.kind, 30 + v.f * 250, 92, true);
	if (v?.kind === 'mouse')
		drawSprite(g, v.kind, 280 - Math.min(1, v.f * 5) * 250, 97);
}
