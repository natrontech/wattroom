import { roomConnection } from '$lib/room/connection.svelte';
import type { Trainer, TrainerSample, TrainerStatus } from '$lib/ble/trainer';
import { type PairState, trainerState } from '$lib/room/sensor-status';

/**
 * The trainer of a SOLO pre-ride screen — /ride and /ramp (#611).
 *
 * A room holds its BLE connection for as long as you stand in it
 * (`room/ride.svelte.ts`, #521). The solo screens had no equivalent: one
 * "Pair trainer and start" button connected and started in the same click, so
 * there was no moment at which a trainer was paired and not yet riding — and
 * so nothing for a paired-devices overview to show. This is that moment.
 *
 * It deliberately does not ride: no target is written, nothing is recorded.
 * `handOff` gives the live connection to `createRideSession`, which takes it
 * from `status === 'connected'` without a second `connect()`.
 */
export function createSoloTrainer() {
	let trainer = $state.raw<Trainer | null>(null);
	let status = $state<TrainerStatus>('disconnected');
	let pairing = $state(false);
	let error = $state<string | null>(null);
	let sample = $state.raw<TrainerSample | null>(null);
	let lastSampleAt = $state(0);
	let now = $state(Date.now());
	let unsubscribe: (() => void)[] = [];

	// Silence is judged against the wall clock, so nothing invalidates this on
	// its own — a trainer that never sends a sample is exactly the case to
	// catch (#520). The interval only runs while there is a trainer to doubt.
	$effect(() => {
		if (!trainer) return;
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});

	const fault = $derived.by((): 'reconnecting' | 'silent' | null => {
		if (!trainer) return null;
		if (status !== 'connected') return 'reconnecting';
		return now - lastSampleAt > 10_000 ? 'silent' : null;
	});

	function release() {
		for (const off of unsubscribe) off();
		unsubscribe = [];
	}

	/** Pair and hold. The rider starts the ride themselves, once. */
	async function pair(next: Trainer): Promise<void> {
		if (pairing) return;
		error = null;
		sample = null;
		pairing = true;
		// One trainer, one rider (#521): a room you are standing in owns the
		// same hardware, so take it back before opening a second channel.
		roomConnection.current?.ride.unpair();
		unsubscribe.push(next.onStatus((s) => (status = s)));
		try {
			await next.connect();
			status = next.status;
			// t0 for the silence check; the first frame should be ~1 s away.
			lastSampleAt = Date.now();
			now = lastSampleAt;
			unsubscribe.push(
				next.onSample((s) => {
					sample = s;
					lastSampleAt = s.at;
				}),
			);
			trainer = next;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
			release();
			status = 'disconnected';
		} finally {
			pairing = false;
		}
	}

	function forget() {
		release();
		void trainer?.disconnect();
		trainer = null;
		status = 'disconnected';
		sample = null;
		lastSampleAt = 0;
		error = null;
	}

	/**
	 * Hand the live connection to the session that will ride it: the slot stops
	 * watching samples and lets go of the reference, without disconnecting.
	 * Returns null when nothing is paired, so a caller cannot start a ride on
	 * a trainer that is not there.
	 */
	function handOff(): Trainer | null {
		const held = trainer;
		release();
		trainer = null;
		status = 'disconnected';
		sample = null;
		lastSampleAt = 0;
		return held;
	}

	return {
		get trainer() {
			return trainer;
		},
		get error() {
			return error;
		},
		/** null while it is behaving; the card renders the rest (#520). */
		get fault() {
			return fault;
		},
		/** The four-state machine every sensor card speaks (sensor-status.ts). */
		get state(): PairState {
			return trainerState(
				{ trainer, fault, error },
				pairing ? 'trainer' : null,
			);
		},
		/**
		 * Live-ness is the honest confirmation, same as a sensor's: a name alone
		 * cannot tell a working trainer from a silent one.
		 */
		get reading(): string | undefined {
			if (!sample) return undefined;
			return `${sample.watts} W · ${sample.cadence} rpm`;
		},
		pair,
		forget,
		handOff,
	};
}
