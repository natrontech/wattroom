import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { code, FILES } from '$lib/source-scan.test-helper';

/**
 * Glow means the number is live (ADR-0005). A trainer that drops left the
 * biggest thing on the riding screen glowing its last value and "on target"
 * under a banner saying the trainer was gone (#2851) — the TV tile already
 * greyed out (#2156), the instrument beside it had no way to. So every
 * riding surface's instrument is found, not listed, and each says whether
 * its numbers are live.
 */
const SRC = join(import.meta.dirname, '../..');
const read = (file: string) => code(readFileSync(join(SRC, file), 'utf8'));
const surfaces = FILES.filter(
	(file) =>
		file.endsWith('.svelte') &&
		!file.startsWith('routes/(app)/dev/') &&
		read(file).includes('<Instrument'),
);

describe('the instrument knows when its numbers are not live (#2851)', () => {
	it('finds the riding surfaces', () => {
		expect(surfaces).toEqual(
			expect.arrayContaining([
				'lib/ride/RidingScreen.svelte',
				'lib/ride/FreeRide.svelte',
				'lib/session/Training.svelte',
				'lib/session/TrainingPhone.svelte',
				'routes/(app)/ramp/+page.svelte',
			]),
		);
	});

	it.each(surfaces)('%s tells every instrument', (file) => {
		const tags = read(file).match(/<Instrument\b[\s\S]*?\/>/g) ?? [];
		expect(tags.length).toBeGreaterThan(0);
		for (const tag of tags) expect(tag).toMatch(/\bstale\b/);
	});
});
