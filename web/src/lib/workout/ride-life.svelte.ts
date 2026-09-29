import type { Trainer, TrainerSample, TrainerStatus } from '$lib/ble/trainer';
import { COUNTDOWN_SECONDS, type RideState } from './ride-state';
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

/** Where a solo ride is in its life; while riding, the guards say how (#3369). */
export type RideLife = 'idle' | 'countdown' | 'riding' | 'done';

/**
 * A solo ride's life (#3369): idle, the count-in, riding, done — and what it
 * takes hold of while it lives and lets go of at its end: its trainer's
 * samples and status, the ticker, the screen's wake lock (#58) and the
 * frame's cave, owned in one place so /ride and /ramp cannot each forget one
 * of them separately. How the ride is going while it rides — running, paused,
 * counting back in — is the guards' to say, not this.
 */
export function createRideLife(
	first: Trainer,
	ride: {
		onSample: (sample: TrainerSample) => void;
		tick: (seconds?: number) => void;
		now: () => number;
		state: () => RideState;
	},
) {
	let life = $state<RideLife>('idle');
	/** Seconds left in the count-in; 0 whenever the ride is not counting in. */
	let countdownRemaining = $state(0);
	// Flipped synchronously by start(), before it awaits the trainer: two taps
	// a frame apart both got past a state check that only moved once the
	// hardware answered (#1800).
	let starting = false;
	// Stamped when the count-in ends, cleared on abort. Not $state: nothing
	// renders it, and only the HUD feed reads it.
	let ridingSince: number | undefined;

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
	/** All of it let go — the trainer stays connected for whoever takes it next. */
	function drop() {
		ticker?.stop();
		ticker = undefined;
		wakeLock?.release();
		wakeLock = undefined;
		deafen();
	}

	return {
		get life() {
			return life;
		},
		get countdownRemaining() {
			return countdownRemaining;
		},
		/**
		 * When the CLOCK started (#2200): a trainer that sends frames without a
		 * power field never produces a first sample, so silence has to be
		 * counted from something that is not one.
		 */
		get ridingSince() {
			return ridingSince;
		},
		get trainer() {
			return trainer;
		},
		get status() {
			return status;
		},
		/**
		 * Start: the count-in, once (#1800). The count-in leaves the button on
		 * screen for three seconds, and a second tap used to build a second
		 * ride on the same trainer. The clock starts when it ends, not when
		 * Start is pressed (ADR-0046).
		 */
		async start() {
			if (starting || life !== 'idle') return;
			starting = true;
			try {
				if (trainer.status !== 'connected') await trainer.connect();
			} catch (cause) {
				starting = false;
				throw cause;
			}
			life = 'countdown';
			countdownRemaining = COUNTDOWN_SECONDS;
			listen();
			latest = {
				get state() {
					return ride.state();
				},
			};
			ticker = createTicker(ride.tick, { now: ride.now });
			wakeLock = acquireWakeLock();
		},
		/** The count-in's seconds; true on the one that ends it and starts the ride. */
		countIn(seconds: number): boolean {
			countdownRemaining = Math.max(0, countdownRemaining - seconds);
			if (countdownRemaining > 0) return false;
			life = 'riding';
			ridingSince = ride.now();
			return true;
		},
		/**
		 * The rider changed their mind during the count-in (#1800): nothing has
		 * been ridden, so there is no ride to end, save or export. Back to idle,
		 * and the trainer handed back still connected for whoever paired it to
		 * hold again (#2615).
		 */
		abort(): Trainer | undefined {
			if (life !== 'countdown') return undefined;
			drop();
			countdownRemaining = 0;
			life = 'idle';
			ridingSince = undefined;
			starting = false;
			return trainer;
		},
		/**
		 * The end, whichever door it came through (#1795); false when the ride
		 * was already over. It lets go of the hardware too (#1546): after the
		 * summary nothing owns this link, and the next pairing screen showed an
		 * unpaired grid over a connection that was still open.
		 */
		end(): boolean {
			if (life === 'done') return false;
			drop();
			countdownRemaining = 0;
			void trainer.setTargetPower(0);
			void trainer.disconnect();
			life = 'done';
			return true;
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
