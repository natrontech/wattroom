// Motion in seconds, not frames (ADR-0079): the world's follow and the pop's
// spring read the same at 30 fps as at 60.

/**
 * An exponential follow with a half-life: the fraction of the remaining
 * distance to cover this step. First order, so it never overshoots — the
 * camera's follow (ADR-0079).
 */
export const damp = (halfLife: number, dt: number): number =>
	1 - Math.pow(2, -dt / halfLife);

/**
 * A damped spring's step response for 0 < ζ < 1, from 0 at t = 0: it rises
 * past 1 by its overshoot and is within 0.25 % of 1 by t = 1 (e^-6), whatever
 * ζ is, so a resampled curve lands without a visible snap — the duration it
 * runs over is the caller's, as with any easing.
 */
export function spring(zeta: number, t: number): number {
	const wn = 6 / zeta;
	const root = Math.sqrt(1 - zeta * zeta);
	return (
		1 -
		Math.exp(-zeta * wn * t) *
			(Math.cos(wn * root * t) + (zeta / root) * Math.sin(wn * root * t))
	);
}

/** docs/SPEC.md "Motion": the pop is a spring at ζ ≈ 0.63, an 8 % overshoot. */
export const POP_ZETA = 0.63;

/** `--ease-pop` as a function: the spring, landing exactly on 1. */
export const pop = (t: number): number => (t >= 1 ? 1 : spring(POP_ZETA, t));
