import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanSource, stale, type Allowlist } from './source-scan.test-helper';

const SRC = join(import.meta.dirname, '..');

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
 *
 * Class-order-proof (#3411). The rule used to search for the literal
 * `font-mono tabular-nums`, and prettier-plugin-tailwindcss sorts a size in
 * between (`font-mono text-[11px] tabular-nums`) — fifty-one class lists got
 * past it that way. So: a class attribute, or a one-line class string in
 * script, holding both words in any order.
 */
const both = (quote: string, body: string) =>
	`${quote}(?=${body}*\\bfont-mono\\b)(?=${body}*\\btabular-nums\\b)${body}*${quote}`;
const MONO_NUMBERS = new RegExp(
	[`\\bclass\\s*=\\s*${both('"', '[^"]')}`, both("'", "[^'\\n]")].join('|'),
	'g',
);

const ALLOWLIST: Allowlist = {
	'routes/(app)/dev/':
		'dev galleries: raw readouts — bytes, timings, fixture dumps — where a monospace face is doing real work',
};

describe('numerals (#2174)', () => {
	it('never asks for tabular numbers in a typeface the theme does not define', () => {
		const { offenders } = scanSource(MONO_NUMBERS, ALLOWLIST);
		expect(
			offenders,
			`use the \`num\` utility (app.css): font-display, tabular figures:\n${offenders.join('\n')}`,
		).toEqual([]);
	});

	it('keeps no allowlist entry that excuses nothing', () => {
		expect(stale(ALLOWLIST, scanSource(MONO_NUMBERS, ALLOWLIST).used)).toEqual(
			[],
		);
	});

	it('defines `num` in the stylesheet, from the display face', () => {
		const css = readFileSync(join(SRC, 'app.css'), 'utf8');
		expect(css).toMatch(/@utility num \{[^}]*--font-display/);
		expect(css).toMatch(/@utility num \{[^}]*tabular-nums/);
	});
});
