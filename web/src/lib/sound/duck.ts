import {
	DUCK_ATTACK_MS,
	DUCK_HOLD_MS,
	DUCK_RELEASE_MS,
} from '$lib/sound/ducking';

/**
 * The one duck (#988). `ducking.ts` already owned the depth and the
 * ballistics; this owns the STATE MACHINE they describe, which is what was
 * still written twice.
 *
 * The cue bus glided `master.gain` on its own release timer; the jukebox dock
 * stepped the iframe's volume on another, inside a component effect. Same
 * numbers, two clocks — so cues and music dipped at audibly different
 * moments, and the music's release did not survive an unrelated re-render:
 * a Svelte effect's cleanup runs before every RE-RUN, not only on destroy, so
 * any dependency changing inside the 600 ms hold cleared the timer that was
 * going to bring the music back, and it sat at 25 % until the next duck cycle
 * happened to end cleanly. Timers that model an envelope must not live inside
 * a reactive effect's cleanup.
 *
 * So: one attack, one hold, one release, in module scope. Each consumer still
 * applies the dip its own way — a WebAudio glide is exact, `setVolume` steps
 * are not — but they are told to move at the same instant.
 */
export interface DuckStep {
	/** Whether the mix should be down under a voice. */
	down: boolean;
	/**
	 * How long to take getting there. 0 means now: a listener that subscribes
	 * mid-duck is told where the mix already is rather than ramping into it,
	 * which is also what makes a fader move act immediately.
	 */
	ms: number;
}

type Listener = (step: DuckStep) => void;

const listeners = new Set<Listener>();
let down = false;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

function announce(ms: number): void {
	for (const listener of [...listeners]) listener({ down, ms });
}

/**
 * Follow the duck. The current state arrives at once, so re-subscribing —
 * which a component effect does whenever anything it reads changes — lands
 * the mix where it already is instead of restarting a ramp.
 */
export function onDuck(listener: Listener): () => void {
	listeners.add(listener);
	listener({ down, ms: 0 });
	return () => {
		listeners.delete(listener);
	};
}

/**
 * Is a voice going? One caller — the room connection, so that this follows
 * the connection rather than whichever page is mounted (#216).
 *
 * Asking for a duck that is already on does nothing: re-triggering would
 * restart the attack ramp on every reading of a voice that has not stopped.
 * Asking for it to stop starts the hold, and asking again inside that hold
 * cancels it — which is how a breath between sentences does not pump the mix.
 */
export function setDucking(next: boolean): void {
	clearTimeout(releaseTimer);
	releaseTimer = undefined;
	if (next) {
		if (down) return;
		down = true;
		announce(DUCK_ATTACK_MS);
		return;
	}
	if (!down) return;
	releaseTimer = setTimeout(() => {
		releaseTimer = undefined;
		down = false;
		announce(DUCK_RELEASE_MS);
	}, DUCK_HOLD_MS);
}

/** Whether the mix is down right now — for a consumer computing a target. */
export function ducking(): boolean {
	return down;
}

/** Test seam: module state outlives a test file without one. */
export function resetDucking(): void {
	clearTimeout(releaseTimer);
	releaseTimer = undefined;
	down = false;
	listeners.clear();
}
