/**
 * The room's shared playhead (#23): where the deck is right now, where a
 * seek is allowed to land, and how the docked player converges on it.
 *
 * Seek-first (docs/SPEC.md, revised #286): past the hard-seek threshold the
 * client jumps, and everything inside it plays straight. Rate-nudging is
 * gone — YouTube rounds unsupported rates toward 1 (RESEARCH.md §10) and the
 * rates it does support are 25 % steps, which on music is a worse artefact
 * than the drift it was correcting.
 *
 * A livestream is the other exception: it has no shared timeline, so the
 * room's anchor walks off into the DVR window and a chasing client seeks on
 * every single tick. Live rides the edge instead.
 */
export type Chase = { do: 'seek'; to: number } | { do: 'hold' };

/** docs/SPEC.md — a seek costs a stutter, so only a real gap earns one. */
export const HARD_SEEK_SEC = 1.5;

export function chase(targetSec: number, atSec: number, live: boolean): Chase {
	if (live) return { do: 'hold' };
	return Math.abs(targetSec - atSec) > HARD_SEEK_SEC
		? { do: 'seek', to: targetSec }
		: { do: 'hold' };
}

/** Mirrors the server's clamp — a track longer than six hours is not a party track. */
export const MAX_SEEK_SEC = 6 * 3600;

/**
 * Where the deck is at `nowMs`: an anchor plus elapsed time, never a counter.
 * `nowMs` must be SERVER time (see server-clock.ts) — the anchor is the
 * server's clock, and feeding this the rider's own was the sync bug (#286).
 */
export function playheadAt(
	deck: { positionSec: number; anchorMs: number; playing: boolean },
	nowMs: number,
	durationSec = 0,
): number {
	const pos =
		deck.positionSec + (deck.playing ? (nowMs - deck.anchorMs) / 1000 : 0);
	return durationSec > 0
		? Math.min(Math.max(pos, 0), durationSec)
		: Math.max(pos, 0);
}

/** Keep a requested seek inside the track — and inside what the server accepts. */
export function clampSeek(pos: number, durationSec = 0): number {
	const max = durationSec > 0 ? durationSec - 1 : MAX_SEEK_SEC;
	return Math.min(Math.max(pos, 0), max);
}
