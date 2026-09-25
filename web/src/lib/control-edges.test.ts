import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A control's edge is the visual information that says it is a control, so
 * WCAG 1.4.11 holds it to 3:1 (#2861). The edges were drawn in `muted` thinned
 * with an alpha, and an alpha routes around the palette gate: an unchecked box
 * composited to 1.55:1 on the light themes and a text field to 1.4:1. They now
 * take `muted-dim`, which the gate fits to the text floor against both
 * surfaces in every theme (palette.test.ts) — so this only has to hold that the
 * edges name the token whole.
 */
const css = readFileSync(
	fileURLToPath(new URL('../app.css', import.meta.url)),
	'utf8',
);

/** The body of the first rule whose selector contains `selector`. */
function rule(selector: string): string {
	const at = css.indexOf(selector);
	expect(at, `no rule for ${selector} in app.css`).toBeGreaterThanOrEqual(0);
	return css.slice(at, css.indexOf('}', at));
}

describe('form control edges', () => {
	it.each([
		[
			'checkbox and radio border',
			":where(input[type='checkbox'], input[type='radio'])",
		],
		[
			'range track (Blink)',
			"input[type='range']::-webkit-slider-runnable-track",
		],
		['range track (Gecko)', "input[type='range']::-moz-range-track"],
	])('the %s is muted-dim, whole', (_, selector) => {
		const body = rule(selector);
		expect(body).toContain('var(--color-muted-dim)');
		expect(body, 'an alpha routes around the gate').not.toMatch(/color-mix/);
	});

	it('a text field is edged in muted-dim, whole', () => {
		const body = rule('@utility input {');
		expect(body).toMatch(/\bborder-muted-dim\b/);
		expect(body, 'an alpha routes around the gate').not.toMatch(
			/\bborder-(?:muted|muted-dim|danger)\/\d+/,
		);
	});
});
