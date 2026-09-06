import { mixer } from '$lib/sound/mixer.svelte';
import { GATE_DEFAULT, clampThreshold } from '$lib/room/gate-scale';

/**
 * What the rider chose about their own mic gate, and the one number the gate
 * and its meter must agree on. SPEC room-audio defaults; persisted per device.
 *
 * Split out of av.svelte.ts (#892) to sit beside gate.ts (the step function)
 * and gate-scale.ts (the axis): all three are the gate, and only this one
 * holds state. Nothing here touches LiveKit or WebAudio.
 */

const VOICE_KEY = 'wattroom.voice.v1';

export type GateMode = 'gate' | 'ptt';
export type GateSettings = ReturnType<typeof createGateSettings>;

export function createGateSettings() {
	let mode = $state<GateMode>('gate');
	let threshold = $state(GATE_DEFAULT);
	let pttHeld = $state(false);
	/** Reactive: the rail draws the EFFECTIVE threshold, and music moves it. */
	let deckPlaying = $state(false);

	try {
		const saved = JSON.parse(localStorage.getItem(VOICE_KEY) ?? '{}');
		if (saved.mode === 'ptt') mode = 'ptt';
		if (typeof saved.threshold === 'number' && saved.threshold > 0)
			threshold = clampThreshold(saved.threshold);
	} catch {
		// storage blocked: SPEC defaults stand
	}

	function persist() {
		try {
			localStorage.setItem(VOICE_KEY, JSON.stringify({ mode, threshold }));
		} catch {
			// per-device convenience only
		}
	}

	return {
		get mode() {
			return mode;
		},
		get threshold() {
			return threshold;
		},
		get pttHeld() {
			return pttHeld;
		},
		/**
		 * SPEC: while the jukebox plays the threshold doubles. The gate reads
		 * it here and the meter's marker reads the same property, so the mark
		 * can never claim a gate the rider is not actually being held to
		 * (#289).
		 *
		 * Two things the doubling has to respect (#478). It pays for speaker
		 * bleed, so it applies only to ears that hear the deck: a rider with
		 * music at zero has no bleed to gate out and stays on what they set.
		 * And doubling is +6 dB, which walks off the top of the axis from a
		 * gate as low as half GATE_CEIL — unclamped, the meter pins its mark
		 * at 100% and the mic can stop opening at all the moment a track
		 * starts.
		 */
		get effective() {
			const bleed = deckPlaying && mixer.music > 0;
			return bleed ? clampThreshold(threshold * 2) : threshold;
		},
		setMode(next: GateMode) {
			mode = next;
			persist();
		},
		setThreshold(next: number) {
			threshold = clampThreshold(next);
			persist();
		},
		setPttHeld(held: boolean) {
			pttHeld = held;
		},
		setDeckPlaying(playing: boolean) {
			deckPlaying = playing;
		},
	};
}
