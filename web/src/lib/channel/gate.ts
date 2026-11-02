/**
 * The gate's dynamics (#514) — when it opens, when it closes, and how fast it
 * gets there. Split from the chain that applies it so the decision is table
 * tested; `gate-scale.ts` owns the axis these numbers live on.
 *
 * The gate is deliberately asymmetric. Opening late clips the first word of a
 * sentence; closing late sends a moment of fan and breathing to the call. On a
 * bike the first is much worse than the second, so: open on the first sample
 * over the mark, close only well under it and only after a hang long enough to
 * ride through the gap between sentences.
 */

import type { VoiceDspOptions } from '$lib/channel/voice-dsp';

/** How far under the open threshold the level must fall to start the hang. */
const GATE_CLOSE_DB = 6;
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

/**
 * The automatic gate (SPEC): open 12 dB over the room's noise floor, the
 * quietest envelope of the last 5 s, and never under -40 dBFS or over
 * -26 dBFS. The floor bounds it: a quiet room opens on a soft "h", a fan or a
 * speaker's bleed lifts it. The ceiling stays well under a talking voice
 * (#2120 measured 0.17 to 0.29), so a loud room never shuts a rider out.
 */
export const AUTO_MARGIN_DB = 12;
export const AUTO_MIN = 0.01;
export const AUTO_MAX = 0.05;
export const FLOOR_WINDOW_MS = 5000;
/** Light noise suppression takes at most 10 dB off any frequency (SPEC). */
export const NS_FLOOR_DB = -10;

export function voiceDspOptions(sampleRate: number): VoiceDspOptions {
	return {
		sampleRate,
		envAttackMs: ENV_ATTACK_MS,
		envReleaseMs: ENV_RELEASE_MS,
		gateAttackMs: GATE_ATTACK_MS,
		gateReleaseMs: GATE_RELEASE_MS,
		holdMs: GATE_HOLD_MS,
		closeDb: GATE_CLOSE_DB,
		autoMarginDb: AUTO_MARGIN_DB,
		autoMin: AUTO_MIN,
		autoMax: AUTO_MAX,
		floorWindowMs: FLOOR_WINDOW_MS,
		nsFloorDb: NS_FLOOR_DB,
	};
}
