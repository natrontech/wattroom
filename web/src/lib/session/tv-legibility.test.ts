import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { code } from '$lib/source-scan.test-helper';

/**
 * TV mode reads at 3 m from a 55-inch set (docs/SPEC.md, the bike computer's
 * legibility table): nothing on it is smaller than 2.9vh, the ANSI/HFES
 * 16-arcminute floor (#3067). rpm at 2.4vh measured 13.2 arcmin and its label
 * 8.8. Read from source, like rider-keys.test.ts: a vh text class is how the
 * TV sizes words, and these are the files that draw them.
 */
const TV = [
	'lib/session/TvOverlay.svelte',
	'lib/session/TvMode.svelte',
	'lib/session/Instrument.svelte',
	'lib/session/IntervalStrip.svelte',
	'lib/components/IntervalGraph.svelte',
];
const FLOOR_VH = 2.9;

const SRC = join(import.meta.dirname, '../..');
const sizes = (file: string) =>
	[
		...code(readFileSync(join(SRC, file), 'utf8')).matchAll(
			/\btext-\[(\d+(?:\.\d+)?)vh\]/g,
		),
	].map((m) => Number(m[1]));

describe('TV mode reads at three metres (#3067)', () => {
	it('sizes its words in vh at all', () => {
		expect(sizes('lib/session/TvMode.svelte').length).toBeGreaterThan(0);
	});

	it.each(TV)('%s draws nothing under 2.9vh', (file) => {
		expect(sizes(file).filter((vh) => vh < FLOOR_VH)).toEqual([]);
	});

	// A shared component draws its TV sizes only when told it is on the TV:
	// the graph's FTP label read 0.8vh there until TvMode said so (#3407).
	it('tells the interval graph it is on the TV', () => {
		const tags =
			code(readFileSync(join(SRC, 'lib/session/TvMode.svelte'), 'utf8')).match(
				/<IntervalGraph\b[\s\S]*?\/>/g,
			) ?? [];
		expect(tags.length).toBeGreaterThan(0);
		for (const tag of tags) expect(tag).toMatch(/\btv\b/);
	});
});
