/**
 * The remembered starting gain (#2120): a quiet mic sounds quiet for the
 * first minute of a call, because Chrome's AGC starts low and climbs. Measured
 * on a −25 dB mic, the sent level went 0.17 → 0.29 over 60 s and was still
 * rising; a loud mic was flat. Turning AGC off is no fix (#555: the gate
 * never opened), so the chain lifts the early speech itself, toward the level
 * this device's last call settled at, and lets go as AGC catches up.
 *
 * Why the gate thresholds stay true: every stored threshold was set against
 * the settled AGC'd signal, and this lifts toward exactly that level and never
 * past it. It only lifts (never below 1×), only for the first minute, and
 * only as far as STARTING_GAIN_MAX. A device with no settled call yet gets 1×.
 */

const KEY = 'wattroom.voice.settled.v1';

/** SPEC: the lift only acts this long after the mic opens. */
export const STARTING_GAIN_MS = 60_000;
/** SPEC: at most +6 dB, a little over the measured ramp. */
export const STARTING_GAIN_MAX = 2;
/** SPEC: how long the lift takes to move, slow enough to read as a voice. */
export const STARTING_GAIN_GLIDE_MS = 1_000;
/** SPEC: speech past the first minute it takes to call a level settled. */
export const SETTLED_SPEECH_MS = 10_000;
/** How fast the estimate of the rider's speech level follows them. */
const SPEECH_TAU_MS = 2_000;

/** The lift for a speech level, given where this device settled last time. */
export function startingGain(
	settled: number | null,
	speech: number,
	sinceOpenMs: number,
): number {
	if (!settled || !(speech > 0) || sinceOpenMs >= STARTING_GAIN_MS) return 1;
	return Math.min(STARTING_GAIN_MAX, Math.max(1, settled / speech));
}

function load(): number | null {
	try {
		const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
		return typeof saved === 'number' && saved > 0 && saved <= 1 ? saved : null;
	} catch {
		return null;
	}
}

export type StartingGain = ReturnType<typeof createStartingGain>;

export function createStartingGain(openedAt: number) {
	const settled = load();
	let last = openedAt;
	let speech = 0;
	let gain = 1;
	let settledSum = 0;
	let settledMs = 0;

	return {
		/**
		 * One meter reading (after the lift); returns the lift to apply. Only
		 * speech moves it: a level under the gate's mark is a pause or the fan.
		 */
		step(level: number, openAt: number, at: number): number {
			const dt = at - last;
			last = at;
			if (level < openAt) return gain;
			const raw = level / gain;
			const since = at - openedAt;
			if (since >= STARTING_GAIN_MS) {
				settledSum += raw * dt;
				settledMs += dt;
			}
			speech =
				speech > 0 ? raw + (speech - raw) * Math.exp(-dt / SPEECH_TAU_MS) : raw;
			gain = startingGain(settled, speech, since);
			return gain;
		},
		/** Remember where this call settled, for the next one on this device. */
		close() {
			if (settledMs < SETTLED_SPEECH_MS) return;
			try {
				localStorage.setItem(KEY, JSON.stringify(settledSum / settledMs));
			} catch {
				// per-device convenience only
			}
		},
	};
}
