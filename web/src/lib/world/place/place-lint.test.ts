import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The placement path's own rules (#3224; #3221's O11 shares the list): a
 * keyed decision uses only IEEE-exact arithmetic, so nothing here may ask for
 * randomness, the clock, or a transcendental function whose last bit an
 * engine chooses. Rendering may use them; placement may not.
 */
export const BANNED =
	/\bMath\.(random|exp|sin|cos|pow|hypot)\b|\bDate\.now\b|\*\*/;

/** Projects a map vertex once and floors it to centimetres (project.ts says why). */
const ALLOWED_TRIG = new Set(['project.ts']);
const MAX_LINES = 300;

const dir = __dirname;
const modules = readdirSync(dir).filter(
	(f) => f.endsWith('.ts') && !f.includes('.test'),
);
const code = (file: string) =>
	readFileSync(join(dir, file), 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/.*$/gm, '');

describe('the placement path', () => {
	it('finds its modules', () => {
		expect(modules).toContain('keyed.ts');
	});

	for (const file of modules)
		it(`${file} stays exact and small`, () => {
			if (!ALLOWED_TRIG.has(file)) expect(code(file)).not.toMatch(BANNED);
			expect(
				readFileSync(join(dir, file), 'utf8').split('\n').length,
			).toBeLessThanOrEqual(MAX_LINES);
		});
});
