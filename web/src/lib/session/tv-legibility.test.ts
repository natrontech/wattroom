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
	'lib/session/BikeComputer.svelte',
	'lib/session/ComputerHead.svelte',
];
const FLOOR_VH = 2.9;

const SRC = join(import.meta.dirname, '../..');
const read = (file: string) => code(readFileSync(join(SRC, file), 'utf8'));
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
	it.each(['IntervalGraph', 'BikeComputer', 'ComputerHead'])(
		'tells the %s it is on the TV',
		(component) => {
			const tags =
				code(
					readFileSync(join(SRC, 'lib/session/TvMode.svelte'), 'utf8'),
				).match(new RegExp(`<${component}\\b[\\s\\S]*?\\/>`, 'g')) ?? [];
			expect(tags.length).toBeGreaterThan(0);
			for (const tag of tags) expect(tag).toMatch(/\btv\b/);
		},
	);

	// The exit hint read 1.1vh, over the interval graph (#3677).
	it('draws its way out at 2.9vh and 44 px, in the top row', () => {
		const exit =
			read('lib/session/TvOverlay.svelte').match(
				/\{#snippet exit\(\)\}([\s\S]*?)\{\/snippet\}/,
			)?.[1] ?? '';
		expect(exit).toMatch(/onclick=\{onExit\}/);
		expect(exit).toMatch(/\bmin-h-11\b/);
		const vh = [...exit.matchAll(/\btext-\[(\d+(?:\.\d+)?)vh\]/g)];
		expect(vh.map((m) => Number(m[1]))).toEqual([expect.any(Number)]);
		expect(Number(vh[0][1])).toBeGreaterThanOrEqual(FLOOR_VH);
		const header =
			read('lib/session/TvMode.svelte').match(
				/<header\b[\s\S]*?<\/header>/,
			)?.[0] ?? '';
		expect(header).toContain('{@render exit?.()}');
	});

	// One home per number (TARGETS D17): the head's 3 s power is the one
	// watts figure, so the TV draws no second power readout (#3677).
	it('draws the 3 s power once, in the head', () => {
		const tv = read('lib/session/TvMode.svelte');
		expect(tv.match(/<ComputerHead\b/g)).toHaveLength(1);
		expect(tv).not.toMatch(/<Instrument\b/);
		// …and the computer under it leaves power and W/kg to that head.
		expect(read('lib/session/BikeComputer.svelte')).toMatch(
			/ownHead: docked \|\| tv\b/,
		);
	});
});
