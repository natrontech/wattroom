import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scan } from './source-scan.test-helper';

/**
 * The structural line has one name (#3420): `border-frame`, which is today's
 * `border-muted/15` exactly. How strong the frames read is then one line in
 * app.css. A literal `border-muted/15` left beside it would stay behind the
 * day that line changes. A state such as `hover:` or `focus:` is not the frame
 * and may still use the literal.
 */
const LITERAL = /(?<![\w:-])border-muted\/15\b/g;

describe('the frame token (#3420)', () => {
	it('draws every structural line through border-frame', () => {
		const { offenders } = scan(LITERAL, {});
		expect(
			offenders,
			`A frame spelled as a literal:\n${offenders.join('\n')}\n` +
				'Use `border-frame` (app.css), so the frames change together.',
		).toEqual([]);
	});

	it('is today’s muted at 15 %, mixed where it is drawn', () => {
		const css = readFileSync(
			join(import.meta.dirname, '..', 'app.css'),
			'utf8',
		);
		expect(css).toMatch(
			/@theme inline \{\s*--color-frame: color-mix\(in oklab, var\(--color-muted\) 15%, transparent\);/,
		);
		expect(css).toMatch(/@utility panel \{\s*@apply border-frame /);
	});
});
