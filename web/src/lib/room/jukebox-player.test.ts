import { describe, expect, it } from 'vitest';
import { deckDuration, playerInfo } from './jukebox-player.svelte';

describe('deckDuration', () => {
	it('is the entry’s length for a library track and the player’s for a video (#1509)', () => {
		playerInfo.duration = 0;
		// A muted rider, or one whose <audio> has not loaded, still gets a bar.
		expect(deckDuration({ trackId: 't', durationMs: 192_914 })).toBeCloseTo(
			192.914,
		);
		playerInfo.duration = 240;
		expect(deckDuration({ trackId: 't', durationMs: 192_914 })).toBeCloseTo(
			192.914,
		);
		// A video's length is only known to the player that loaded it.
		expect(deckDuration({})).toBe(240);
		expect(deckDuration(null)).toBe(240);
		// A library track from before the field existed falls back to the element.
		expect(deckDuration({ trackId: 't' })).toBe(240);
	});
});
