import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { code, FILES } from '$lib/source-scan.test-helper';

/**
 * The flash budget (ADR-0079): `--color-z6`, `--color-z7`, `--color-danger`
 * and `--color-watt` never blink. A keyframe that names one of them is that
 * blink — the landing's sprint game flipped its frame to watt and back twice
 * a second while it was armed (#3447).
 */
const NEVER_BLINK = /--color-(?:watt|z6|z7|danger)\b/;
const SRC = join(import.meta.dirname, '../..');

/** Every `@keyframes` block in a source, braces balanced. */
function keyframes(source: string): { name: string; body: string }[] {
	const found: { name: string; body: string }[] = [];
	for (const m of source.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
		let depth = 1;
		let i = m.index + m[0].length;
		while (depth > 0 && i < source.length) {
			if (source[i] === '{') depth++;
			else if (source[i] === '}') depth--;
			i++;
		}
		found.push({ name: m[1], body: source.slice(m.index + m[0].length, i) });
	}
	return found;
}

describe('the flash budget (ADR-0079)', () => {
	it('never blinks watt, z6, z7 or danger', () => {
		const offenders = FILES.filter((file) =>
			/\.(svelte|css)$/.test(file),
		).flatMap((file) =>
			keyframes(code(readFileSync(join(SRC, file), 'utf8')))
				.filter((k) => NEVER_BLINK.test(k.body))
				.map((k) => `${file}: @keyframes ${k.name}`),
		);
		expect(
			offenders,
			`A keyframe that blinks a colour ADR-0079 says never blinks:\n  ${offenders.join('\n  ')}\n` +
				'Hold the colour steady, or say it once — a single pop — rather than on and off.',
		).toEqual([]);
	});
});
