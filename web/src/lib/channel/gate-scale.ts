/**
 * One coordinate system for the voice gate (#289). The mic meter and the
 * threshold that gates it are drawn on the same axis, so "my voice peaks
 * here, the gate sits there" is a glance rather than an inference between a
 * percentage bar and a raw amplitude slider.
 *
 * The axis is dBFS because that is the unit speech is spaced in: on a linear
 * amplitude axis every usable gate position — room tone up to a firm voice —
 * is crushed into the first tenth of the travel, and the other nine tenths
 * cover levels nobody ever speaks at.
 */

/** Meter floor: quieter than this is a silent room, not a quiet voice. */
export const GATE_MIN_DB = -54;
/** Meter ceiling: a gate this high only opens for a shout. */
export const GATE_MAX_DB = -12;

/** dBFS of an analyser RMS level (0..1). Silence reads as the floor. */
export function gateDb(level: number): number {
	if (level <= 0) return GATE_MIN_DB;
	return 20 * Math.log10(level);
}

/** The RMS level a dBFS reading stands for — the inverse of gateDb. */
export function gateLevel(db: number): number {
	return 10 ** (db / 20);
}

/** Where a level sits on the shared axis, 0..100, clamped to it. */
export function gatePct(level: number): number {
	const span = GATE_MAX_DB - GATE_MIN_DB;
	const pct = ((gateDb(level) - GATE_MIN_DB) / span) * 100;
	return Math.min(100, Math.max(0, pct));
}

/**
 * The band a threshold may sit in is the axis itself: every settable value
 * has a place on the meter, and every place on the meter is settable.
 */
export const GATE_FLOOR = gateLevel(GATE_MIN_DB);
export const GATE_CEIL = gateLevel(GATE_MAX_DB);

/** SPEC room audio: the gate opens at analyser RMS >= 0.02. */
export const GATE_DEFAULT = 0.02;

export function clampThreshold(level: number): number {
	if (!Number.isFinite(level)) return GATE_DEFAULT;
	return Math.min(GATE_CEIL, Math.max(GATE_FLOOR, level));
}
