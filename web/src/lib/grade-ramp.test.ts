import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast } from './color';
import { CONTRAST } from './palette';
import { THEMES } from './themes';

/**
 * The Skyline's grade ramp (#3059) is the theme's neon mixed with nothing, at
 * five strengths, so it has no hex of its own to fall out of a theme with.
 * Held like the zone ramp (#331): on every theme, both families, each step
 * reads stronger than the one before against both surfaces, and the steepest
 * clears the accent floor.
 */
const css = readFileSync(join(import.meta.dirname, '..', 'app.css'), 'utf8');
const shares = [
	...css.matchAll(
		/--color-grade-(\d): color-mix\(in oklab, var\(--color-neon\) (\d+)%, transparent\);/g,
	),
].map((m) => Number(m[2]) / 100);

/** A colour at `alpha` over a background, blended the way a browser does, in sRGB. */
function over(hex: string, alpha: number, background: string): string {
	const rgb = (h: string) =>
		[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
	const [f, b] = [rgb(hex), rgb(background)];
	return (
		'#' +
		f
			.map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha)))
			.map((c) => c.toString(16).padStart(2, '0'))
			.join('')
	);
}

describe('the grade ramp (#3059)', () => {
	it('is five steps of neon, each stronger than the last', () => {
		expect(shares).toHaveLength(5);
		for (let i = 1; i < shares.length; i++)
			expect(shares[i]).toBeGreaterThan(shares[i - 1]);
	});

	it.each(THEMES.map((t) => [t.id, t] as const))(
		'reads step by step on %s',
		(_, theme) => {
			for (const surface of [
				theme.tokens.surface,
				theme.tokens['surface-raised'],
			]) {
				const steps = shares.map((a) =>
					contrast(over(theme.tokens.neon, a, surface), surface),
				);
				for (let i = 1; i < steps.length; i++)
					expect(steps[i], `step ${i + 1} against ${surface}`).toBeGreaterThan(
						steps[i - 1],
					);
				expect(steps.at(-1)).toBeGreaterThanOrEqual(CONTRAST.accent);
			}
		},
	);
});
