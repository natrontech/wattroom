import { FtmsTrainer } from '$lib/ble/ftms';
import { pairError } from '$lib/ble/pair-error';
import type { Trainer } from '$lib/ble/trainer';

/**
 * A lost trainer's one way back mid-ride (#2881): the chooser, then the ride
 * rides on with the trainer picked. The riding screen's status line and the
 * ride dock's say the same, so they press the same button.
 */
export function createPairAgain(onPaired: (next: Trainer) => void) {
	let busy = $state(false);
	let error = $state<string | null>(null);
	return {
		get busy() {
			return busy;
		},
		/** Why the chooser did not hand a trainer back; null until it fails. */
		get error() {
			return error;
		},
		async run() {
			busy = true;
			error = null;
			const next = new FtmsTrainer();
			try {
				await next.connect();
				onPaired(next);
			} catch (cause) {
				error = pairError(cause);
			} finally {
				busy = false;
			}
		},
	};
}
