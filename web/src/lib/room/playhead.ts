/**
 * The room's shared playhead (#23): where the deck is right now, where a
 * seek is allowed to land, and how the docked player converges on it.
 *
 * Tiered (docs/SPEC.md, revised #286). A real gap seeks — it costs a stutter,
 * so it has to be earned. Anything smaller closes on the playback rate, which
 * nobody can hear: settled by doing on a live embed (2026-08-31), a 1.05×
 * request comes back as 1.05, while 1.02× rounds to 1 — the docs' "rounds
 * unsupported rates toward 1" is real but its floor is far finer than
 * getAvailablePlaybackRates() advertises. An embed that ignores the nudge
 * anyway loses nothing: its drift grows until the seek tier takes it.
 *
 * A livestream is the exception: it has no shared timeline, so the room's
 * anchor walks off into the DVR window and a chasing client seeks on every
 * single tick. Live rides the edge instead.
 */
export type Chase = { do: 'seek'; to: number } | { do: 'rate'; rate: number };

/** docs/SPEC.md — a seek costs a stutter, so only a real gap earns one. */
export const HARD_SEEK_SEC = 1.5;
/** Below this, the drift is not worth touching; above it, the rate closes it. */
export const NUDGE_SEC = 0.25;
/** The finest step this embed honours — 0.02 rounds away to 1. */
export const NUDGE_RATE = 0.05;

export function chase(targetSec: number, atSec: number, live: boolean): Chase {
	if (live) return { do: 'rate', rate: 1 };
	const drift = targetSec - atSec;
	if (Math.abs(drift) > HARD_SEEK_SEC) return { do: 'seek', to: targetSec };
	if (Math.abs(drift) > NUDGE_SEC)
		return { do: 'rate', rate: drift > 0 ? 1 + NUDGE_RATE : 1 - NUDGE_RATE };
	return { do: 'rate', rate: 1 };
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
