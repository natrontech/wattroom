import type { Trainer, TrainerSample, TrainerStatus } from '$lib/ble/trainer';
import type { RideState } from './ride-state';
import { createTicker, type Ticker } from './ticker';
import { acquireWakeLock, type WakeLock } from './wakelock';

/**
 * The frame caves while a solo session is live (ADR-0020: the ride is the
 * cave, sidebar included). The layout cannot see a page's session, so the
 * last one started is published here; /ride and /ramp stop theirs on destroy.
 */
let latest = $state.raw<{ state: RideState } | null>(null);
export const soloRide = {
	get active() {
		return !!latest && latest.state !== 'idle' && latest.state !== 'done';
	},
};

/**
 * What a solo ride takes hold of while it runs and lets go of at its end:
 * its trainer's samples and status, the ticker, the screen's wake lock
 * (#58) and the frame's cave — owned in one place so /ride and /ramp cannot
 * each forget one of them separately.
 */
export function createRideHold(
	first: Trainer,
	ride: {
		onSample: (sample: TrainerSample) => void;
		tick: (seconds?: number) => void;
		now: () => number;
		state: () => RideState;
	},
) {
	let trainer = first;
	// The link as the driver reports it (#1847): the screen draws the
	// recovery card from this, not from a slot that let go at Start.
	let status = $state<TrainerStatus>(first.status);
	let offSample: (() => void) | undefined;
	let offStatus: (() => void) | undefined;
	let ticker: Ticker | undefined;
	let wakeLock: WakeLock | undefined;

	function listen() {
		offSample = trainer.onSample(ride.onSample);
		offStatus = trainer.onStatus((s) => (status = s));
		status = trainer.status;
	}
	function deafen() {
		offSample?.();
		offSample = undefined;
		offStatus?.();
		offStatus = undefined;
	}

	return {
		get trainer() {
			return trainer;
		},
		get status() {
			return status;
		},
		/** The ride starts: its trainer is listened to, its clock ticks, the screen stays on. */
		take() {
			listen();
			latest = {
				get state() {
					return ride.state();
				},
			};
			ticker = createTicker(ride.tick, { now: ride.now });
			wakeLock = acquireWakeLock();
		},
		/** All of it let go — the trainer stays connected for whoever takes it next. */
		drop() {
			ticker?.stop();
			ticker = undefined;
			wakeLock?.release();
			wakeLock = undefined;
			deafen();
		},
		/** Listen to `next` instead; the old trainer is returned for the caller to let go. */
		swap(next: Trainer): Trainer {
			const old = trainer;
			deafen();
			trainer = next;
			listen();
			return old;
		},
	};
}
