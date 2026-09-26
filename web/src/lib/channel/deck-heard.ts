import type { JukeboxState, ServerTick } from '$lib/protocol';

/** The last deck this socket heard, and which revision it was. */
export interface DeckHeard {
	rev: number;
	deck: JukeboxState;
}

/**
 * The deck by revision (#2838): the server sends it on the tick that changes
 * it and names it by `jukeboxRev` on every other, the way the workout rides by
 * hash (#1710). A tick that carries a deck is remembered; one that does not
 * gets the remembered deck filled back in — the same object, so nothing
 * downstream re-reads a queue that did not change. Returns what to remember.
 */
export function fillDeck(
	tick: ServerTick,
	heard: DeckHeard | null,
): DeckHeard | null {
	if (tick.jukebox) return { rev: tick.jukeboxRev, deck: tick.jukebox };
	// A revision this socket never heard is a frame lost after it was queued;
	// the server sends it again next tick. Until then the last deck stands.
	if (heard) tick.jukebox = heard.deck;
	return heard;
}
