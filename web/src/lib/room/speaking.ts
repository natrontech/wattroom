import { GATE_SHUT, gateStep, type GateState } from '$lib/room/gate';

/**
 * Who is talking, measured rather than remembered (#987).
 *
 * It used to be LiveKit's `ActiveSpeakersChanged` — a decision the SERVER
 * makes and broadcasts on an interval. Two things follow from that, and both
 * were bugs. It is late, because the sound has to reach the SFU and the
 * verdict has to come back before anything lights up (#988). And it is a
 * MEMORY: a rider who left or muted mid-sentence was never mentioned again,
 * so the flag outlived its subject and the tile stayed ringed for as long as
 * the room lasted.
 *
 * A reading cannot go stale. The audio is already in the browser on its way
 * to the speakers, so the level is taken there (`av-output.ts` puts the same
 * meter the mic gate uses on each rider's chain) and the answer is whatever
 * the last few milliseconds actually contained. When the track goes, so does
 * the meter, and `drop` takes the rider with it.
 *
 * The numbers are the gate's, from docs/SPEC.md: open at RMS ≥ 0.02, hold
 * while within 6 dB of that, shut after a hang. `gateStep` is the same
 * decision the rider's own mic makes about itself — one rule, one home.
 */

/**
 * Where a remote voice counts as speech. SPEC's gate threshold: the signal is
 * the published one, AGC'd and Opus-coded, which is what that number was
 * measured against.
 */
export const SPEAKING_AT = 0.02;

/**
 * How long a voice stays lit after it stops. Shorter than the mic gate's
 * 1200 ms hang: the gate is deciding whether to keep transmitting, where
 * cutting a word is the expensive mistake, and this is deciding whether to
 * draw a ring. Long enough to ride the gap between words, short enough that
 * the ring follows the conversation rather than trailing it.
 */
export const SPEAKING_HOLD_MS = 400;

export interface Speaking {
	/**
	 * One envelope reading for one CONNECTION. Returns whether the answer for
	 * anybody changed, so the caller only writes reactive state when it did —
	 * levels arrive fifty times a second per rider.
	 */
	level(identity: string, level: number, now: number): boolean;
	/** That connection is gone: no reading can arrive, so nothing holds it lit. */
	drop(identity: string): boolean;
	/** Left the room entirely. */
	clear(): void;
	/** Who is talking, by rider — never by connection. */
	readonly riders: Record<string, boolean>;
}

/**
 * @param riderOf which rider a connection belongs to. A rider with two tabs
 * open holds two connections (#293), and they are one voice: either one
 * carrying speech lights them, and both have to fall quiet to put it out.
 */
export function createSpeaking(
	riderOf: (identity: string) => string,
): Speaking {
	const gates = new Map<string, GateState>();
	const owner = new Map<string, string>();
	let riders: Record<string, boolean> = {};

	/** Rebuild from the connections; returns whether anything actually moved. */
	function settle(): boolean {
		const next: Record<string, boolean> = {};
		for (const [identity, gate] of gates)
			if (gate.open) next[owner.get(identity) ?? identity] = true;
		const before = Object.keys(riders);
		const after = Object.keys(next);
		if (before.length === after.length && after.every((id) => riders[id]))
			return false;
		riders = next;
		return true;
	}

	return {
		get riders() {
			return riders;
		},
		level(identity, level, now) {
			owner.set(identity, riderOf(identity));
			const gate = gateStep(
				gates.get(identity) ?? GATE_SHUT,
				level,
				SPEAKING_AT,
				now,
				SPEAKING_HOLD_MS,
			);
			gates.set(identity, gate);
			return settle();
		},
		drop(identity) {
			if (!gates.delete(identity)) return false;
			owner.delete(identity);
			return settle();
		},
		clear() {
			gates.clear();
			owner.clear();
			riders = {};
		},
	};
}
