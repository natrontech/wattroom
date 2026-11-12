import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, hexToOklch, oklchToHex } from './color';
import { CONTRAST } from './palette';
import { THEMES } from './themes';

/**
 * The Flat and Map views' place (#4536): the world's dusk, ridges and meadow
 * mixed into each theme's surface (app.css). The rail's words stand on the
 * sky, the distance posts on the land, and the road's bed (paper) lies on it,
 * so each mix is held, on every theme in its own family, to what stands on
 * it: a word at the text floor, the bed apart from the land under it.
 */
const css = readFileSync(join(import.meta.dirname, '..', 'app.css'), 'utf8');
const world = Object.fromEntries(
	[...css.matchAll(/(--world-[a-z0-9-]+): (#[0-9a-f]{6});/g)].map((m) => [
		m[1],
		m[2],
	]),
);
const MIX = String.raw`color-mix\(in oklab, var\((--world-[a-z-]+)\) (\d+)%, var\(--color-surface\)\)`;
const tints = Object.fromEntries(
	[
		...css.matchAll(
			new RegExp(
				String.raw`--color-((?:sky|ridge|land)[a-z0-9-]*): light-dark\(\s*${MIX},\s*${MIX}\s*\);`,
				'g',
			),
		),
	].map((m) => [
		m[1],
		{
			light: { of: m[2], share: Number(m[3]) / 100 },
			dark: { of: m[4], share: Number(m[5]) / 100 },
		},
	]),
);

/** `share` of `a` into `b`, mixed in OKLab as the browser's color-mix does. */
function mix(a: string, share: number, b: string): string {
	const lab = (hex: string) => {
		const { l, c, h } = hexToOklch(hex);
		const r = (h * Math.PI) / 180;
		return [l, c * Math.cos(r), c * Math.sin(r)];
	};
	const [x, y] = [lab(a), lab(b)];
	const [l, A, B] = x.map((v, i) => v * share + y[i] * (1 - share));
	return oklchToHex({
		l,
		c: Math.hypot(A, B),
		h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360,
	});
}

describe('the Flat and Map views’ place (#4536)', () => {
	it('reads every tint from app.css', () => {
		expect(Object.keys(tints).sort()).toEqual([
			'land',
			'land-deep',
			'ridge-far',
			'ridge-near',
			'sky-1',
			'sky-2',
			'sky-3',
		]);
		for (const t of Object.values(tints))
			for (const f of [t.light, t.dark]) expect(world[f.of]).toBeDefined();
	});

	it.each(THEMES.map((t) => [t.id, t] as const))(
		'keeps words and the road readable on %s',
		(_, theme) => {
			const surface = theme.tokens.surface;
			const tint = (name: string) => {
				const f = tints[name][theme.family];
				return mix(world[f.of], f.share, surface);
			};
			// The rail's words, and its second row, over the sky's upper
			// half. Nearer the horizon every word stands on a chip.
			for (const sky of ['sky-1', 'sky-2'])
				expect(
					contrast(theme.tokens.muted, tint(sky)),
					`muted on ${sky}`,
				).toBeGreaterThanOrEqual(CONTRAST.text);
			// The distance posts' kilometres, on the land and the field under it.
			for (const ground of ['land', 'land-deep', 'ridge-near'])
				expect(
					contrast(theme.tokens.ink, tint(ground)),
					`ink on ${ground}`,
				).toBeGreaterThanOrEqual(CONTRAST.text);
			// The road's bed stands apart from the land it lies on.
			expect(
				contrast(theme.tokens.paper, tint('land')),
				'the bed on the land',
			).toBeGreaterThanOrEqual(1.2);
			// And the land is not the page: it reads as somewhere.
			expect(
				contrast(surface, tint('land')),
				'the land on the page',
			).toBeGreaterThanOrEqual(1.1);
		},
	);
});
