import { createObcController, type Controller } from './controller';
import type { ObcAction, ObcEdge, ObcFeel } from './obc';
import { pairError } from './pair-error';
import type { SensorStatus } from './sensor';

/**
 * The paired shifter, shared across the app like the sensors (#3335): a
 * rider pairs it before the ride and it presses whichever ride shifts. One
 * slot; nothing persists, since a Web Bluetooth grant does not survive a
 * reload.
 */
let status = $state<SensorStatus>('disconnected');
let name = $state<string>();
let error = $state<string>();
let pairing = $state(false);
let held: { controller: Controller; release: () => void } | undefined;
const actionCbs = new Set<(action: ObcAction, edge: ObcEdge) => void>();

/** Hang up first, so its held buttons let go through the subscriptions. */
async function release(): Promise<void> {
	const was = held;
	held = undefined;
	if (!was) return;
	await was.controller.disconnect();
	was.release();
}

export const shifterSlot = {
	get status() {
		return status;
	},
	get name() {
		return name;
	},
	get error() {
		return error;
	},
	get pairing() {
		return pairing;
	},

	async pair(make: () => Controller = createObcController): Promise<void> {
		if (pairing) return;
		await release();
		error = undefined;
		name = undefined;
		pairing = true;
		const controller = make();
		const offs = [
			controller.onStatus((next) => (status = next)),
			controller.onAction((action, edge) => {
				for (const cb of actionCbs) cb(action, edge);
			}),
		];
		held = { controller, release: () => offs.forEach((off) => off()) };
		try {
			await controller.connect();
			name = controller.name;
		} catch (cause) {
			await release();
			status = 'disconnected';
			error = pairError(cause);
		} finally {
			pairing = false;
		}
	},

	async forget(): Promise<void> {
		await release();
		status = 'disconnected';
		name = undefined;
		error = undefined;
	},

	/** Every press from whichever controller is paired now or later. Returns unsubscribe. */
	onAction(cb: (action: ObcAction, edge: ObcEdge) => void): () => void {
		actionCbs.add(cb);
		return () => actionCbs.delete(cb);
	},

	/** A gear moved or met an end: the controller's own vibration. */
	feel(feel: ObcFeel): void {
		held?.controller.feel(feel);
	},
};
