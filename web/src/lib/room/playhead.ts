/**
 * The room's shared playhead (#23): where the deck is right now, where a
 * seek is allowed to land, and how the docked player converges on it.
 *
 * Tiered: a big gap seeks, a small one nudges the playback rate, anything
 * inside the deadband plays straight. A livestream is the exception — it has
 * no shared timeline, so the room's anchor walks off into the DVR window and
 * a chasing client seeks on every single tick. Live rides the edge instead.
 */
export type Chase = { do: 'seek'; to: number } | { do: 'rate'; rate: number };

export function chase(targetSec: number, atSec: number, live: boolean): Chase {
	if (live) return { do: 'rate', rate: 1 };
	const drift = targetSec - atSec;
	if (Math.abs(drift) > 2) return { do: 'seek', to: targetSec };
	if (Math.abs(drift) > 0.3)
		return { do: 'rate', rate: drift > 0 ? 1.25 : 0.75 };
	return { do: 'rate', rate: 1 };
}

/** Mirrors the server's clamp — a track longer than six hours is not a party track. */
export const MAX_SEEK_SEC = 6 * 3600;

/** Where the deck is at `nowMs`: an anchor plus wall time, never a counter. */
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
