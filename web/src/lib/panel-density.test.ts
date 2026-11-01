import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from 'tailwindcss';

/**
 * The kit's size variants (`panel-lg`, `btn-xs`, `input-xs`) beat their base
 * purely by emitting later in the utilities layer — app.css says so and nothing
 * held it. A Tailwind upgrade that reorders the layer would not error: every
 * spacious panel would quietly redraw at the default density, which is the kind
 * of regression that ships. So compile the real stylesheet and read the order
 * out of it.
 */
const require = createRequire(import.meta.url);
const SRC = resolve(import.meta.dirname, '..');

async function emissionOrder(candidates: string[]): Promise<string> {
	const compiled = await compile(readFileSync(join(SRC, 'app.css'), 'utf8'), {
		base: SRC,
		loadStylesheet: async (id, base) => {
			const file = require.resolve(
				id === 'tailwindcss' ? 'tailwindcss/index.css' : id,
				{ paths: [base] },
			);
			return {
				base: dirname(file),
				path: file,
				content: readFileSync(file, 'utf8'),
			};
		},
	});
	return compiled.build(candidates);
}

describe('a size variant emits after the base it overrides', () => {
	it('puts every panel density after .panel, and a one-off after both', async () => {
		const css = await emissionOrder([
			'panel',
			'panel-lg',
			'panel-xl',
			'panel-flush',
			'btn',
			'btn-xs',
			'btn-lg',
			'btn-ride',
			'input',
			'input-xs',
			'p-1',
			'p-8',
			'px-6',
			'py-10',
		]);
		const at = (selector: string) => {
			const i = css.indexOf(`${selector} {`);
			expect(i, `${selector} is not in the built stylesheet`).toBeGreaterThan(
				-1,
			);
			return i;
		};
		// Later in the file wins at equal specificity: each of these has to
		// sit after the rule it is meant to override.
		for (const variant of ['.panel-lg', '.panel-xl', '.panel-flush']) {
			expect(at(variant), `${variant} must emit after .panel`).toBeGreaterThan(
				at('.panel'),
			);
		}
		for (const [base, variant] of [
			['.btn', '.btn-xs'],
			['.btn', '.btn-lg'],
			['.btn', '.btn-ride'],
			['.input', '.input-xs'],
		]) {
			expect(at(variant), `${variant} must emit after ${base}`).toBeGreaterThan(
				at(base),
			);
		}
		// A call site that keeps its own padding still has to beat the density
		// .panel now carries.
		for (const one of ['.p-1', '.p-8', '.px-6', '.py-10']) {
			expect(at(one), `${one} must emit after .panel`).toBeGreaterThan(
				at('.panel'),
			);
		}
	});
});
