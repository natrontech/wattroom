/**
 * Sitting out the room's music (#989). Two verbs, both a decision about this
 * client's own player: skip-for-me is over the moment the room's play
 * changes, stop-for-me waits to be rejoined. Nothing reaches the server —
 * ADR-0018 already makes the jukebox a rider's own iframe at their own
 * volume, so stepping out of it is not the room's business and there is no
 * roster of who is listening.
 *
 * Not persisted, like away (mixer.svelte.ts): being out is where a rider is
 * this sitting, not how they like their mix. A reload puts them back in.
 */

/** A play, not a video: a repeat of the same track carries a new anchor (#286). */
export type Play = { videoId: string; anchorMs: number };

let mode = $state<'skip' | 'stop' | null>(null);
/** The play we walked out on — what a skip is waiting to see change. */
let leftOn = $state<Play | null>(null);
/**
 * Its length, in seconds, as this client measured it before unloading. Only
 * clients ever know a duration (the server holds an anchor, not a timeline),
 * so it is 0 for a livestream and for a rider who joined already stopped.
 */
let leftDuration = $state(0);

function samePlay(a: Play | null, b: Play | null): boolean {
	return !!a && !!b && a.videoId === b.videoId && a.anchorMs === b.anchorMs;
}

export const listening = {
	get out(): boolean {
		return mode !== null;
	},
	get mode(): 'skip' | 'stop' | null {
		return mode;
	},
	/** Out now. `on` is what the room is running, `durationSec` its length. */
	stepOut(kind: 'skip' | 'stop', on: Play | null, durationSec = 0) {
		mode = kind;
		leftOn = on;
		leftDuration = durationSec > 0 ? durationSec : 0;
	},
	rejoin() {
		mode = null;
		leftOn = null;
		leftDuration = 0;
	},
	/**
	 * The room's current play, read on every chase tick. A skip ends as soon
	 * as it differs from the one we left on — including the room stopping
	 * altogether. A stop ignores it and waits for Rejoin.
	 */
	sees(now: Play | null) {
		if (mode !== 'skip') return;
		if (!samePlay(now, leftOn)) this.rejoin();
	},
	/**
	 * How long the room's current play is, when this client is the one that
	 * measured it. The next track is a length we never saw, and inventing it
	 * is what the countdown must never do.
	 */
	durationOf(now: Play | null): number {
		return samePlay(now, leftOn) ? leftDuration : 0;
	},
};

/**
 * Seconds until the room's next track, or null when nothing can be predicted
 * — a livestream has no timeline at all, and a length we never measured is
 * not one to run a timer toward.
 */
export function backIn(durationSec: number, elapsedSec: number): number | null {
	return durationSec > 0 ? Math.max(0, durationSec - elapsedSec) : null;
}

/**
 * What the docked player should do this tick. Out never chases: with nothing
 * loaded there is no drift to measure, so no seek and no rate nudge may be
 * issued — the room's playhead is left entirely alone.
 */
export function playerAction(
	out: boolean,
	loaded: boolean,
): 'unload' | 'idle' | 'chase' {
	if (!out) return 'chase';
	return loaded ? 'unload' : 'idle';
}
