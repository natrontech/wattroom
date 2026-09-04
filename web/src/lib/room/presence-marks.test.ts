import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tileFrame } from './presence-marks';

const SRC = join(import.meta.dirname, '..', '..');
/** Every surface that draws a person as a tile — the Lounge and the strip. */
const TILES = ['lib/room/RiderTile.svelte', 'lib/nav/RoomStrip.svelte'];

describe('presence marks (#505)', () => {
	it('rings a speaker in the voice colour, never the live-data hue', () => {
		// ADR-0005: watt marks live data and is the only thing that glows.
		// Speaking is presence, so it is z4 — the roster's voice colour.
		expect(tileFrame(true)).toContain('ring-z4');
		expect(tileFrame(true)).not.toMatch(/watt|glow/);
	});

	it('gives an idle tile an edge that exists in both families', () => {
		expect(tileFrame(false)).toContain('ring-edge');
	});

	it('makes away a third quiet presence state, never live data', () => {
		expect(tileFrame(true, true)).toContain('ring-edge');
		expect(tileFrame(true, true)).toContain('opacity-60');
		expect(tileFrame(true, true)).not.toMatch(/watt|glow|ring-z4/);
	});

	it('draws the strip and the Lounge tile from the one vocabulary', () => {
		for (const tile of TILES) {
			const source = readFileSync(join(SRC, tile), 'utf8');
			expect(source, `${tile} hand-rolls its frame`).toContain('tileFrame(');
			expect(source, `${tile} omits the shared away mark`).toContain(
				'AWAY_MARK',
			);
			// A ring spelled out at the call site is how the two drifted apart.
			expect(source.match(/ring-(?:z4|neon|ink)/), tile).toBeNull();
		}
	});
});
