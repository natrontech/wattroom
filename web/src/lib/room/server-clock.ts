/**
 * Server time, on this machine's clock (#286).
 *
 * The jukebox anchor is server millis, and every client used to add its OWN
 * `Date.now()` to it. A laptop's wall clock is routinely seconds off — that
 * skew went straight into the playhead, so each rider chased a different
 * target and the "synced" jukebox never was.
 *
 * No ping/pong protocol is needed: every tick already carries the server's
 * clock. One sample is `at - receivedAt` = trueOffset − networkDelay, so the
 * LARGEST recent sample (the least-delayed tick) is the closest to the truth.
 * Eight samples at 1 Hz keeps the window at ~8 s, which is also how fast the
 * estimate re-converges after a reconnect or a server restart.
 */

const SAMPLES = 8;

let samples: number[] = [];
let offset = 0;

/** Feed one tick's server timestamp. Called from the room socket, nowhere else. */
export function observeServerTime(at: number) {
	if (!Number.isFinite(at) || at <= 0) return;
	samples = [...samples.slice(-(SAMPLES - 1)), at - Date.now()];
	offset = Math.max(...samples);
}

/** Server millis. Falls back to the local clock until the first tick lands. */
export function serverNow(): number {
	return Date.now() + offset;
}

/** How far this machine's clock sits from the server's, in ms. Diagnostics. */
export function clockOffsetMs(): number {
	return offset;
}

/** A fresh socket may reach a restarted server — drop the old window. */
export function resetServerClock() {
	samples = [];
	offset = 0;
}
