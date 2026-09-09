/**
 * The personal ride guards: auto-pause and the spiral release.
 *
 * Personal because they follow the rider and not the timeline. Solo, the two
 * are the same thing and the clock stops with the rider. In a group ride the
 * room's clock belongs to the room — so the guards mask THIS rider's target
 * and nothing else, and the shared session runs on without them (#788).
 *
 * A plain machine, no runes: both callers already own the reactivity, and the
 * numbers here are docs/SPEC.md's — do not tune them in code.
 */

export const DEFAULTS = {
	/** Below this cadence AND below pedallingWatts, the rider has stopped. */
	pauseCadence: 5,
	/**
	 * Power floor for "still pedalling". Cadence alone is not safe: a Kickr v2 reports
	 * no cadence at all (RESEARCH.md §9), and keying auto-pause on cadence would leave
	 * those riders permanently paused mid-ride.
	 */
	pedallingWatts: 20,
	/** Seconds of not-pedalling before their targets pause. */
	pauseAfterSeconds: 3,
	/** Countdown shown when they start again, so resuming is not a jump-scare. */
	resumeCountdown: 3,
	/** Spiral guard: cadence under this while an ERG target is held. */
	spiralCadence: 50,
	/** ...for this long, before the target is released. */
	spiralAfterSeconds: 5,
	/** No cadence source? Fall back to power collapsing this far under target. */
	spiralPowerFraction: 0.5,
	/** How long the target stays released once the guard trips. */
	spiralReleaseSeconds: 10,
	/** Bias step and range for the ±% control. */
	biasStep: 0.01,
	biasMin: 0.8,
	biasMax: 1.2,
} as const;

/** Where the rider is, personally — the room may be somewhere else entirely. */
export type GuardPhase = 'running' | 'autopaused' | 'resuming';

export interface GuardSample {
	watts: number;
	cadence: number;
}

export function createPersonalGuards() {
	let phase: GuardPhase = 'running';
	let idleSeconds = 0;
	let lowCadenceSeconds = 0;
	let spiralSeconds = 0;
	let resumeIn = 0;

	return {
		get phase() {
			return phase;
		},
		get resumeIn() {
			return resumeIn;
		},
		get spiralActive() {
			return spiralSeconds > 0;
		},
		/**
		 * While true the rider's prescribed target must read as zero. Resuming
		 * is deliberately NOT released: the target is back on screen during the
		 * countdown, and only the trainer waits — resuming is not a jump-scare.
		 */
		get released() {
			return phase === 'autopaused' || spiralSeconds > 0;
		},
		/** Is the rider turning the pedals at all? The caller's accounting wants it. */
		pedalling(sample: GuardSample): boolean {
			return (
				sample.cadence >= DEFAULTS.pauseCadence ||
				sample.watts >= DEFAULTS.pedallingWatts
			);
		},

		/**
		 * One sample against the target the rider was PRESCRIBED — not the one
		 * the trainer currently holds, which is zero exactly when a guard is up.
		 * Returns whether the trainer has to be told something new.
		 *
		 * `seconds` is how much of the clock this sample stands for — 1 for the
		 * first sample of a wall-clock second, 0 for the rest (#1798). The
		 * counters are named in seconds because docs/SPEC.md names the
		 * thresholds in seconds; a trainer notifying at 2 Hz used to reach
		 * auto-pause in 1.5 s and the spiral release in 2.5 s. Transitions
		 * still fire on every sample: a stop is noticed by the sample that
		 * stopped, and a resume by the first one turning again.
		 */
		sample(sample: GuardSample, target: number, seconds = 1): boolean {
			let actuate = false;
			// Auto-pause: their targets stop, the clock does not rewind.
			if (!this.pedalling(sample)) {
				if (phase === 'running') {
					idleSeconds += seconds;
					if (idleSeconds >= DEFAULTS.pauseAfterSeconds) {
						phase = 'autopaused';
						actuate = true;
					}
				}
			} else {
				idleSeconds = 0;
				if (phase === 'autopaused') {
					phase = 'resuming';
					resumeIn = DEFAULTS.resumeCountdown;
				}
			}

			// Spiral guard. Cadence is the good signal; power collapse is the fallback
			// when no cadence source exists at all (RESEARCH.md §9 — the Kickr v2 case).
			if (phase === 'running' && target > 0 && spiralSeconds === 0) {
				const collapsing =
					sample.cadence > 0
						? sample.cadence < DEFAULTS.spiralCadence
						: sample.watts < target * DEFAULTS.spiralPowerFraction;
				lowCadenceSeconds = collapsing ? lowCadenceSeconds + seconds : 0;
				if (lowCadenceSeconds >= DEFAULTS.spiralAfterSeconds) {
					spiralSeconds = DEFAULTS.spiralReleaseSeconds;
					lowCadenceSeconds = 0;
					actuate = true;
				}
			}
			return actuate;
		},

		/** Advance the countdowns. Returns whether the trainer has to be told. */
		tick(seconds = 1): boolean {
			if (phase === 'resuming') {
				resumeIn -= seconds;
				if (resumeIn <= 0) {
					resumeIn = 0;
					phase = 'running';
					return true;
				}
				return false;
			}
			if (phase !== 'running') return false;
			if (spiralSeconds > 0) {
				spiralSeconds = Math.max(0, spiralSeconds - seconds);
				return spiralSeconds === 0;
			}
			return false;
		},

		/** Back to a rider who is riding — a fresh session, or a fresh trainer. */
		reset(): void {
			phase = 'running';
			idleSeconds = lowCadenceSeconds = spiralSeconds = resumeIn = 0;
		},
	};
}
