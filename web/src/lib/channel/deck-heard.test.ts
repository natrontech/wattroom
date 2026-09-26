import { describe, expect, it } from 'vitest';
import type { JukeboxState, ServerTick } from '$lib/protocol';
import { fillDeck } from './deck-heard';

const deck = (title: string): JukeboxState => ({
	queue: [
		{ id: 'e1', videoId: 'dQw4w9WgXcQ', title, addedBy: 'jan' },
	] as JukeboxState['queue'],
	playing: true,
	positionSec: 0,
	anchorMs: 1,
	history: [],
});
const tick = (rev: number, jukebox?: JukeboxState) =>
	({ at: 0, state: {}, jukeboxRev: rev, jukebox }) as unknown as ServerTick;

// The deck rides only the tick that changes it (#2838); every consumer still
// reads tick.jukebox, so the client fills the one it heard back in.
describe('fillDeck', () => {
	it('remembers a deck that rode, and fills it into the ticks that follow', () => {
		const first = deck('Warmup');
		let heard = fillDeck(tick(1, first), null);
		const quiet = tick(1);
		heard = fillDeck(quiet, heard);
		expect(quiet.jukebox).toBe(first);
		expect(heard?.rev).toBe(1);
	});
	it('takes the new deck when the revision moves', () => {
		const heard = fillDeck(tick(1, deck('Warmup')), null);
		const next = deck('Threshold');
		expect(fillDeck(tick(2, next), heard)).toEqual({ rev: 2, deck: next });
	});
	it('keeps the last deck over a revision it never heard', () => {
		const first = deck('Warmup');
		const heard = fillDeck(tick(1, first), null);
		const lost = tick(2);
		expect(fillDeck(lost, heard)?.rev).toBe(1);
		expect(lost.jukebox).toBe(first);
	});
	it('leaves a tick alone before any deck was heard', () => {
		const early = tick(3);
		expect(fillDeck(early, null)).toBeNull();
		expect(early.jukebox).toBeUndefined();
	});
});
