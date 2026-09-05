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
/**
 * The best estimate so far. It outlives a reset: zero would not mean
 * "unknown" to `serverNow()`, it would mean "this machine's clock IS server
 * time", and the dock chases the instant a tab comes back — so a reset that
 * zeroed it hard-seeked the playhead by the rider's full skew and seeked back
 * on the next tick (#644). `null` only until the first tick ever.
 */
let offset: number | null = null;

/** Feed one tick's server timestamp. Called from the room socket, nowhere else. */
export function observeServerTime(at: number) {
	if (!Number.isFinite(at) || at <= 0) return;
	// A backgrounded tab has its delivery throttled and batched, so EVERY
	// sample it takes reads late — and a late sample looks exactly like a
	// server running behind. The max-filter can only reject one while a
	// prompt sample is still in the ring, so a tab hidden for the whole
	// window evicts its good samples and adopts the bias wholesale
	// (measured at ~2 s against a foreground client). It keeps what it
	// learned on screen instead — through a reset too, or a reconnect while
	// hidden would hand the returning tab a throttled first reading to chase.
	// With no estimate at all it still takes the sample: rough beats none.
	if (offset !== null && hidden()) return;
	samples = [...samples.slice(-(SAMPLES - 1)), at - Date.now()];
	offset = Math.max(...samples);
}

function hidden(): boolean {
	return (
		typeof document !== 'undefined' && document.visibilityState === 'hidden'
	);
}

/** Server millis. Falls back to the local clock until the first tick ever. */
export function serverNow(): number {
	return Date.now() + (offset ?? 0);
}

/** How far this machine's clock sits from the server's, in ms. Diagnostics. */
export function clockOffsetMs(): number {
	return offset ?? 0;
}

/**
 * A fresh socket may reach a restarted server, and a tab back from the
 * background has only late samples — drop the window so the next tick
 * replaces the estimate wholesale. The estimate itself stays: whatever
 * chases before that tick lands runs on server time, not the wall clock.
 */
export function resetServerClock() {
	samples = [];
}
