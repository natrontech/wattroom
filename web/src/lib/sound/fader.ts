/**
 * One place every fader's travel is defined (#509), the way `gate-scale.ts`
 * owns the voice gate's axis. A fader added at its own resolution is how the
 * mix ended up with 21-position sliders.
 *
 * Resolution is 1 % of travel, because a fader's step is not a uniform amount
 * of loudness: 5 % near unity is an inaudible 0.4 dB, but 5 % → 10 % is +6 dB,
 * and low is exactly where a rider is trying to be precise. Nothing downstream
 * wants the quantisation — the rider gain ramps through `setTargetAtTime` and
 * the music level through the jukebox's `rampTo`, so a finer fader costs no
 * zipper noise.
 *
 * These are the fader's coordinates, not a taper: the value a fader emits is
 * still the level it always was.
 */

export interface Fader {
	min: number;
	max: number;
	step: number;
}

/** Jukebox ceiling, on the YouTube player's own 0–100 scale. */
export const MUSIC_FADER: Fader = { min: 0, max: 100, step: 1 };

/** A rider's voice, in percent of unity — 200 % is the "make them louder" ask (#463). */
export const RIDER_FADER: Fader = { min: 0, max: 200, step: 1 };

/** Cue level and duck depth, both plain 0–1 gains. */
export const UNIT_FADER: Fader = { min: 0, max: 1, step: 0.01 };

/**
 * How hard voice ducking dips the music, out of the box (SPEC.md: "to 25 %
 * of the rider's own volume"). One constant so the mixer's persisted default
 * and the cue engine's own fallback can't drift apart the way they did (#677).
 */
export const DUCK_DEFAULT = 0.25;
