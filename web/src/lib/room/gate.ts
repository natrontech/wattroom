/**
 * The gate's dynamics (#514) — when it opens, when it closes, and how fast it
 * gets there. Split from the chain that applies it so the decision is table
 * tested; `gate-scale.ts` owns the axis these numbers live on.
 *
 * The gate is deliberately asymmetric. Opening late clips the first word of a
 * sentence; closing late sends a moment of fan and breathing to the room. On a
 * bike the first is much worse than the second, so: open on the first sample
 * over the mark, close only well under it and only after a hang long enough to
 * ride through the gap between sentences.
 */

/** How far under the open threshold the level must fall to start the hang. */
export const GATE_CLOSE_DB = 6;
/** Below the close mark this long, and only then, the gate shuts (SPEC). */
export const GATE_HOLD_MS = 1200;
/** Gain ramps (SPEC): fast up so no syllable is clipped, slow down so a
 *  mistimed close fades instead of cutting. */
export const GATE_ATTACK_MS = 5;
export const GATE_RELEASE_MS = 150;
/** Level smoothing: catch a syllable's attack, let it fall gently (SPEC). */
export const ENV_ATTACK_MS = 5;
export const ENV_RELEASE_MS = 150;

/**
 * A one-pole envelope. The gate and the meter read the same number, so a
 * level that jumps around by the syllable would both chatter the gate and
 * make the bar dance — the point of the ballistics is that neither happens.
 */
export function envelope(
	previous: number,
	level: number,
	dtMs: number,
	attackMs = ENV_ATTACK_MS,
	releaseMs = ENV_RELEASE_MS,
): number {
	const tau = level > previous ? attackMs : releaseMs;
	if (!(dtMs > 0) || tau <= 0) return level;
	const decay = Math.exp(-dtMs / tau);
	return level + (previous - level) * decay;
}

/** The level the gate closes under, given the level it opens at. */
export function closeLevel(openAt: number): number {
	return openAt * 10 ** (-GATE_CLOSE_DB / 20);
}

export interface GateState {
	open: boolean;
	/** When the level was last loud enough to hold the gate open. */
	loudAt: number;
}

export const GATE_SHUT: GateState = { open: false, loudAt: 0 };

/**
 * One step of the gate, given the envelope now. `openAt` is the effective
 * threshold — the rider's, doubled while the jukebox plays (#478).
 */
export function gateStep(
	state: GateState,
	level: number,
	openAt: number,
	now: number,
	holdMs = GATE_HOLD_MS,
): GateState {
	// Once open, the far lower close mark holds it: a level hovering at one
	// threshold would otherwise chatter open and shut on its own noise.
	const holdsOpen = state.open ? closeLevel(openAt) : openAt;
	if (level >= holdsOpen) return { open: true, loudAt: now };
	if (!state.open) return state;
	return now - state.loudAt >= holdMs
		? { open: false, loudAt: state.loudAt }
		: state;
}
