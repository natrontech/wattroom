import type { AvStatus } from '#lib/channel/av-types.ts';

/** Waits between rejoin attempts after a drop; the last one repeats. */
export const RECOVER_DELAYS_MS = [2_000, 4_000, 8_000, 15_000, 30_000];

export interface RecoverHost {
	/** Rejoin with the mic the way the rider left it; resolves when the attempt is over. */
	join(): Promise<void>;
	status(): AvStatus;
	/** The refusal a retry cannot fix: signed out. */
	signedOut(): boolean;
	/** The rider is still on the place the call belonged to. */
	stillHere(): boolean;
}

/**
 * Gets a rider back into voice after LiveKit drops them (#219, #4343).
 *
 * One try two seconds after the drop is not enough: LiveKit gives up only
 * after its own retry window, so the network is often still down for that
 * try, and nothing tried again. This keeps trying with a growing wait, and
 * tries at once when the browser reports the network back. It stops when the
 * rider is live, hangs up, is signed out, or has voice on another screen.
 */
export function createVoiceRecovery(host: RecoverHost) {
	let armed = false;
	let busy = false;
	let tries = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;

	function clear() {
		if (timer !== null) clearTimeout(timer);
		timer = null;
	}

	function stop() {
		armed = false;
		tries = 0;
		clear();
	}

	function later() {
		clear();
		const wait =
			RECOVER_DELAYS_MS[Math.min(tries, RECOVER_DELAYS_MS.length - 1)];
		tries += 1;
		timer = setTimeout(attempt, wait);
	}

	async function attempt() {
		timer = null;
		if (!armed || busy) return;
		if (!host.stillHere()) return stop();
		const before = host.status();
		if (before === 'live') return stop();
		// An attempt of the rider's own is under way; look again after it.
		if (before === 'connecting' || before === 'reconnecting') return later();
		busy = true;
		try {
			await host.join();
		} finally {
			busy = false;
		}
		if (!armed) return;
		const after = host.status();
		// Live is done. Off after a join is a refused seat: the voice is on
		// another screen of theirs, and joining here would double it.
		if (after === 'live' || after === 'off' || host.signedOut()) return stop();
		later();
	}

	return {
		/** LiveKit dropped the rider while they were in voice. */
		dropped() {
			armed = true;
			tries = 0;
			later();
		},
		/** The rider hung up: stand down. */
		left: stop,
		/** The browser says the network is back: try now, not at the next wait. */
		online() {
			if (!armed || busy) return;
			clear();
			void attempt();
		},
		stop,
	};
}
