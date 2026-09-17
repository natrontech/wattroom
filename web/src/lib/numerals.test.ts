import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..');

function sources(dir = SRC): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sources(path);
		return /\.(svelte|ts)$/.test(name) && !name.endsWith('.test.ts')
			? [path]
			: [];
	});
}

/**
 * web/AGENTS.md: "Display type and every numeral use `font-display`."
 *
 * The rule is canon and the code drifted (#2174): `font-mono tabular-nums`
 * appeared on seventy-five sites, and `--font-mono` is Tailwind's default
 * stack — the theme declares `--font-sans` and `--font-display` and nothing
 * else. So numbers rendered in whichever monospace the OS happens to ship,
 * beside Chakra Petch numbers on the same row, and nothing said so: it looks
 * deliberate until you see the two faces together.
 *
 * `num` is that rule with a name. A bare `font-mono` is still allowed — a
 * code, a token, an address or inline code is a string that happens to
 * contain digits, and a monospace face is doing real work there.
 */
describe('numerals (#2174)', () => {
	it('never asks for tabular numbers in a typeface the theme does not define', () => {
		const offenders = sources()
			.filter((path) =>
				readFileSync(path, 'utf8').includes('font-mono tabular-nums'),
			)
			.map((path) => path.slice(SRC.length + 1));
		expect(
			offenders,
			'use the `num` utility (app.css): font-display, tabular figures',
		).toEqual([]);
	});

	it('defines `num` in the stylesheet, from the display face', () => {
		const css = readFileSync(join(SRC, 'app.css'), 'utf8');
		expect(css).toMatch(/@utility num \{[^}]*--font-display/);
		expect(css).toMatch(/@utility num \{[^}]*tabular-nums/);
	});
});
