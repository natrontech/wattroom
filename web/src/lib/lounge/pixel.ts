/**
 * Drawing on the lounge's canvas, one whole pixel at a time. Every
 * coordinate is rounded, so nothing lands between pixels and the picture
 * scales up sharp (ADR-0092's rule against detail finer than a pixel). Light
 * is an ordered dither of solid pixels, never a blend, and things are
 * outlined in ink.
 */

export type Ctx = CanvasRenderingContext2D;

export function rect(
	g: Ctx,
	x: number,
	y: number,
	w: number,
	h: number,
	c: string,
) {
	g.fillStyle = c;
	g.fillRect(Math.round(x), Math.round(y), w, h);
}

export function dot(g: Ctx, x: number, y: number, c: string) {
	rect(g, x, y, 1, 1, c);
}

/** One piece of a figure or prop: x, y, width, height, colour. */
export type Part = readonly [number, number, number, number, string];

/** Pieces drawn over a one-pixel ink outline around all of them. */
export function outlined(g: Ctx, parts: readonly Part[], ink: string) {
	for (const [x, y, w, h] of parts) rect(g, x - 1, y - 1, w + 2, h + 2, ink);
	for (const [x, y, w, h, c] of parts) rect(g, x, y, w, h, c);
}

/** Bresenham: a one-pixel line with no antialiasing. */
export function line(
	g: Ctx,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	c: string,
) {
	x0 = Math.round(x0);
	y0 = Math.round(y0);
	x1 = Math.round(x1);
	y1 = Math.round(y1);
	const dx = Math.abs(x1 - x0);
	const dy = -Math.abs(y1 - y0);
	const sx = x0 < x1 ? 1 : -1;
	const sy = y0 < y1 ? 1 : -1;
	let e = dx + dy;
	for (;;) {
		dot(g, x0, y0, c);
		if (x0 === x1 && y0 === y1) return;
		const e2 = 2 * e;
		if (e2 >= dy) {
			e += dy;
			x0 += sx;
		}
		if (e2 <= dx) {
			e += dx;
			y0 += sy;
		}
	}
}

/**
 * A limb or a tube from a to b, w pixels thick, with an ink edge: squares
 * stamped along the line, ink first and a pixel wider all round.
 */
export function limb(
	g: Ctx,
	a: readonly number[],
	b: readonly number[],
	w: number,
	c: string,
	ink: string,
) {
	const steps = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1])));
	const at = (i: number) => [
		Math.round(a[0] + ((b[0] - a[0]) * i) / steps - (w - 1) / 2),
		Math.round(a[1] + ((b[1] - a[1]) * i) / steps - (w - 1) / 2),
	];
	for (let i = 0; i <= steps; i++) {
		const [x, y] = at(i);
		rect(g, x - 1, y - 1, w + 2, w + 2, ink);
	}
	for (let i = 0; i <= steps; i++) {
		const [x, y] = at(i);
		rect(g, x, y, w, w, c);
	}
}

/** A circle's outline, by the midpoint rule. */
export function ring(g: Ctx, cx: number, cy: number, r: number, c: string) {
	let x = r;
	let y = 0;
	let d = 1 - r;
	while (x >= y) {
		for (const [a, b] of [
			[x, y],
			[y, x],
			[-y, x],
			[-x, y],
			[-x, -y],
			[-y, -x],
			[y, -x],
			[x, -y],
		])
			dot(g, cx + a, cy + b, c);
		y++;
		if (d < 0) d += 2 * y + 1;
		else {
			x--;
			d += 2 * (y - x) + 1;
		}
	}
}

export function disc(g: Ctx, cx: number, cy: number, r: number, c: string) {
	for (let y = -r; y <= r; y++) {
		const w = Math.floor(Math.sqrt(r * r - y * y));
		rect(g, cx - w, cy + y, w * 2 + 1, 1, c);
	}
}

/** A filled ellipse, row by row: the 3/4 view's circles (rugs, cushions, shadows). */
export function ellipse(
	g: Ctx,
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	c: string,
) {
	for (let y = -ry; y <= ry; y++) {
		const w = Math.round(
			rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry || 1))),
		);
		rect(g, cx - w, cy + y, w * 2 + 1, 1, c);
	}
}

/** The 4 × 4 Bayer matrix: the order an ordered dither fills its pixels in. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * Light falling on a surface: an ordered dither of `c`, densest at the
 * centre and gone at the rim. `strength` 1 fills the centre solid.
 */
export function pool(
	g: Ctx,
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	c: string,
	strength = 1,
) {
	for (let y = -ry; y <= ry; y++)
		for (let x = -rx; x <= rx; x++) {
			const d = (x * x) / (rx * rx) + (y * y) / (ry * ry);
			if (d >= 1) continue;
			const px = Math.round(cx + x);
			const py = Math.round(cy + y);
			if (BAYER[(py & 3) * 4 + (px & 3)] / 16 < (1 - d) * strength)
				dot(g, px, py, c);
		}
}

/** A bitmap drawn from rows of '1' and '0'. */
export function sprite(
	g: Ctx,
	rows: readonly string[],
	x: number,
	y: number,
	c: string,
) {
	rows.forEach((row, j) => {
		for (let i = 0; i < row.length; i++)
			if (row[i] === '1') dot(g, x + i, y + j, c);
	});
}

/** A bitmap with an ink edge: drawn at its four neighbours in ink, then itself. */
export function inkedSprite(
	g: Ctx,
	rows: readonly string[],
	x: number,
	y: number,
	c: string,
	ink: string,
) {
	for (const [dx, dy] of [
		[-1, 0],
		[1, 0],
		[0, -1],
		[0, 1],
	])
		sprite(g, rows, x + dx, y + dy, ink);
	sprite(g, rows, x, y, c);
}

/** Digits, W and a plus, three or five pixels wide and five tall. */
const GLYPHS: Record<string, readonly string[]> = {
	'0': ['111', '101', '101', '101', '111'],
	'1': ['010', '110', '010', '010', '111'],
	'2': ['111', '001', '111', '100', '111'],
	'3': ['111', '001', '111', '001', '111'],
	'4': ['101', '101', '111', '001', '001'],
	'5': ['111', '100', '111', '001', '111'],
	'6': ['111', '100', '111', '101', '111'],
	'7': ['111', '001', '001', '001', '001'],
	'8': ['111', '101', '111', '101', '111'],
	'9': ['111', '101', '111', '001', '111'],
	W: ['10001', '10001', '10101', '10101', '01010'],
	'+': ['000', '010', '111', '010', '000'],
	' ': ['00', '00', '00', '00', '00'],
};

export function textWidth(s: string): number {
	let w = 0;
	for (const ch of s) w += (GLYPHS[ch]?.[0].length ?? 0) + 1;
	return Math.max(0, w - 1);
}

export function text(g: Ctx, s: string, x: number, y: number, c: string) {
	for (const ch of s) {
		const glyph = GLYPHS[ch];
		if (!glyph) continue;
		sprite(g, glyph, x, y, c);
		x += glyph[0].length + 1;
	}
}
