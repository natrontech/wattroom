/**
 * Drawing on the lounge's 320 × 180 canvas, one whole pixel at a time. Every
 * coordinate is rounded, so nothing lands between pixels and the picture
 * scales up sharp (ADR-0092's rule against detail finer than a pixel).
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
