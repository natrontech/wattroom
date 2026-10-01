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
/**
 * The rest of the placement path (#3221, O11): the gates that admit a
 * placement, and what the props and set pieces decide with. kit.ts is not here:
 * it reads its numbers off three's models and rounds them to the millimetre,
 * so an engine's last bit never reaches a decision.
 */
const placement = [
	...readdirSync(join(dir, '../placement'))
		.filter((f) => f.endsWith('.ts') && !f.includes('.test'))
		.map((f) => `../placement/${f}`),
	'../props/scatter.ts',
	'../props/roads.ts',
	'../props/placer.ts',
	'../props/rhythm.ts',
	'../setpieces.ts',
];
const code = (file: string) =>
	readFileSync(join(dir, file), 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/.*$/gm, '');

describe('the placement path', () => {
	it('finds its modules', () => {
		expect(modules).toContain('keyed.ts');
		expect(placement).toContain('../placement/rules.ts');
	});

	for (const file of modules)
		it(`${file} stays exact and small`, () => {
			if (!ALLOWED_TRIG.has(file)) expect(code(file)).not.toMatch(BANNED);
			expect(
				readFileSync(join(dir, file), 'utf8').split('\n').length,
			).toBeLessThanOrEqual(MAX_LINES);
		});

	for (const file of placement)
		it(`${file} stays exact`, () => {
			expect(code(file)).not.toMatch(BANNED);
		});
});
