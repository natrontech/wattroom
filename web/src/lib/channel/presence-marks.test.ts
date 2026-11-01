import { describe, expect, it } from 'vitest';
import { tileFrame } from './presence-marks';

describe('presence marks (#505)', () => {
	it('rings a speaker in the voice colour, never the live-data hue', () => {
		// ADR-0005: watt marks live data and is the only thing that glows.
		// Speaking is presence, so it is z4 — the roster's voice colour.
		expect(tileFrame(true)).toContain('outline-z4');
		expect(tileFrame(true)).not.toMatch(/watt|glow/);
	});

	it('gives an idle tile an edge that exists in both families', () => {
		expect(tileFrame(false)).toContain('outline-edge');
	});

	it('makes away a third quiet presence state, never live data', () => {
		expect(tileFrame(true, true)).toContain('outline-edge/50');
		expect(tileFrame(true, true)).not.toMatch(/watt|glow|outline-z4/);
		// Quiet by its frame, not by fading the tile: opacity took the name on
		// it under the text floor (#2888).
		expect(tileFrame(true, true)).not.toMatch(/opacity/);
	});
});
