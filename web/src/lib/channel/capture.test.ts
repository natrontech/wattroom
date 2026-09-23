import { describe, expect, it } from 'vitest';
import { MIC_CONSTRAINTS } from './capture';

describe('mic capture constraints (#555)', () => {
	it('keeps automatic gain control on', () => {
		// Not a preference: LiveKit reads the published track's level to decide
		// who is speaking, the jukebox ducks from that, and every rider's
		// stored gate threshold was set against an AGC'd signal. Switching this
		// off once made the room inaudible and stopped the music dipping.
		expect(MIC_CONSTRAINTS.autoGainControl).toBe(true);
	});

	it('keeps echo cancellation — the one DSP a rider on speakers needs', () => {
		expect(MIC_CONSTRAINTS.echoCancellation).toBe(true);
	});

	it('sends the voice without noise suppression (ADR-0043, #1340)', () => {
		expect(MIC_CONSTRAINTS.noiseSuppression).toBe(false);
	});
});
