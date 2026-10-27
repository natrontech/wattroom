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
	it('finds none: every riding head is the bike computer’s', () => {
		// The free ride's head (#3669), every other riding panel's (#3670) and
		// a session on a phone's (#4233) is the bike computer's, whose `stale`
		// the type checker requires. An instrument back on a riding surface
		// lands here, and must say whether its numbers are live.
		for (const file of surfaces) {
			const tags = read(file).match(/<Instrument\b[\s\S]*?\/>/g) ?? [];
			for (const tag of tags) expect(tag, file).toMatch(/\bstale\b/);
		}
		expect(surfaces).toEqual([]);
	});
});

/**
 * A voice channel's places draw your instrument before anything is paired,
 * and its 0 glowed as though measured (#2941).
 */
describe('the instrument knows when nothing is paired (#2941)', () => {
	it('every instrument on a riding surface says so', () => {
		for (const file of surfaces) {
			const tags = read(file).match(/<Instrument\b[\s\S]*?\/>/g) ?? [];
			for (const tag of tags) expect(tag, file).toMatch(/\bidle\b/);
		}
	});

	it('a phone’s own unmeasured numbers are not live (#4233)', () => {
		expect(read('lib/session/SessionNumbers.svelte')).toMatch(
			/stale=\{mine\s*\?\s*channel\.youStale \|\| \(phone && channel\.youUnmeasured\)/,
		);
	});
});
