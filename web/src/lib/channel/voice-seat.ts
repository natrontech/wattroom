import type {
	ClientMessage,
	SensorPairing,
	ServerMessage,
} from '$lib/protocol';

/**
 * How long a screen waits to hear whether it carries its rider's voice before
 * it joins anyway. The hub answers on its next tick, within a second; a
 * server too old to know the claim never answers, and joins as it always did.
 */
export const VOICE_ANSWER_MS = 2_500;

/** Whether the pairing says where this rider's voice is, and if here. */
function seatOf(pairing: SensorPairing): boolean | null {
	if (pairing.held?.includes('voice')) return true;
	if (pairing.elsewhere?.voice) return false;
	return null;
}

/**
 * One screen's claim on its rider's voice (ADR-0089): asked before the call
 * opens, so a refused screen never joins it and never echoes. The hub's
 * answer is the pairing it sends every screen of the rider, and a refusal's
 * `voice_conflict` lands first.
 */
export function createVoiceSeat(
	send: (message: ClientMessage) => void,
	tab: () => string,
	device: () => string,
) {
	let wanted = false;
	let answer: ((here: boolean) => void) | null = null;
	// A take is never refused: a pairing still naming the other screen was
	// on its way before the hub moved the voice.
	let taking = false;
	const claimOf = (on: boolean, take = false) => ({
		voice: { on, take, tab: tab(), device: device() },
	});

	return {
		/**
		 * Ask to carry the voice here; `take` moves it from another screen.
		 * Resolves whether this screen may join the call.
		 */
		claim(take: boolean, pairing: SensorPairing): Promise<boolean> {
			wanted = true;
			answer?.(false);
			taking = take;
			send(claimOf(true, take));
			if (!take && seatOf(pairing) === true) return Promise.resolve(true);
			return new Promise((resolve) => {
				const timer = setTimeout(() => settle(true), VOICE_ANSWER_MS);
				const settle = (here: boolean) => {
					clearTimeout(timer);
					if (answer === settle) answer = null;
					resolve(here);
				};
				answer = settle;
			});
		},
		/** This screen left the call: the voice is nobody's until claimed. */
		release() {
			if (!wanted) return;
			wanted = false;
			answer?.(false);
			send(claimOf(false));
		},
		/** A fresh socket is a fresh claim to the hub (#610's reason). */
		replay() {
			if (wanted) send(claimOf(true));
		},
		heard(msg: ServerMessage) {
			if (!answer) return;
			if (msg.error?.code === 'voice_conflict' && !taking) answer(false);
			else if (msg.pairing) {
				const here = seatOf(msg.pairing);
				if (here === true || (here === false && !taking)) answer(here);
			}
		},
	};
}
