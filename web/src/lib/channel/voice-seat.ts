import type {
	ClientMessage,
	SensorPairing,
	ServerMessage,
} from '$lib/protocol';

/**
 * How long a screen with an open socket waits to hear whether it carries its
 * rider's voice before it joins anyway. The hub answers on its next tick,
 * within a second; a server too old to know the claim never answers, and the
 * screen joins as it always did.
 */
export const VOICE_ANSWER_MS = 2_500;
/**
 * How long a claim waits for a socket that is not open. The claim is queued
 * behind it, and joining without the hub's answer is how two screens double;
 * past this the screen stays out and the rider taps again.
 */
export const VOICE_WAIT_MAX_MS = 15_000;

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
 *
 * A screen with no tab label (storage blocked) claims nothing: each of its
 * sockets would be a stranger to the last, and a reconnect would refuse its
 * own call. It joins as an older client does.
 */
export function createVoiceSeat(
	send: (message: ClientMessage) => void,
	tab: () => string,
	device: () => string,
	connected: () => boolean,
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
			if (!tab()) return Promise.resolve(true);
			wanted = true;
			answer?.(false);
			taking = take;
			send(claimOf(true, take));
			if (!take && seatOf(pairing) === true) return Promise.resolve(true);
			const started = Date.now();
			return new Promise((resolve) => {
				let timer: ReturnType<typeof setTimeout>;
				const settle = (here: boolean) => {
					clearTimeout(timer);
					if (answer === settle) answer = null;
					// A refused screen is a controller: it claims nothing more,
					// and a reconnect of its socket must not claim for it.
					if (!here) wanted = false;
					resolve(here);
				};
				const wait = () => {
					if (connected()) return settle(true);
					if (Date.now() - started >= VOICE_WAIT_MAX_MS) return settle(false);
					timer = setTimeout(wait, VOICE_ANSWER_MS);
				};
				timer = setTimeout(wait, VOICE_ANSWER_MS);
				answer = settle;
			});
		},
		/** This screen left the call: the voice is nobody's until claimed. */
		release() {
			const had = wanted;
			wanted = false;
			answer?.(false);
			if (had) send(claimOf(false));
		},
		/** A fresh socket is a fresh claim to the hub (#610's reason). */
		replay() {
			if (wanted) send(claimOf(true, taking && answer !== null));
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
