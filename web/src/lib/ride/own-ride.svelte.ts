import { byReference } from '$lib/workout/road-workout';
import { account } from '$lib/account.svelte';
import { pairError } from '$lib/ble/pair-error';
import type { Trainer } from '$lib/ble/trainer';
import { openRideBuffer, type RideBuffer } from '$lib/ride/buffer';
import { recordingUpload, uploadRide, type SaveFailure } from '$lib/ride/save';
import { sensors } from '$lib/sensors.svelte';
import { wireMetrics } from '$lib/session/wire';
import { createRideSession } from '$lib/workout/session.svelte';
import type { Workout } from '$lib/workout/types';

type RideSession = ReturnType<typeof createRideSession>;

export type OwnRideOutcome =
	{ saved: string | null } | { failure: SaveFailure } | { nothing: true };

/**
 * Your own workout, beside the channel's session (#2329, ADR-0059 amended):
 * picked from the same library as /ride and ridden on the ride-alone
 * lifecycle — the 3 s count-in, your own clock with +1 min and Skip block,
 * saved and scored like a ride alone. Its live numbers go to whoever has the
 * channel open, as a free ride's do; the workout's name and steps go to
 * nobody. It is a spectator of any session: nothing of it counts there, and
 * joining the session saves it first.
 *
 * It borrows the channel's trainer for the ride and hands it back at the end,
 * so the channel keeps one trainer and one control channel to it (#521). It
 * lives on the connection beside the free ride, so it keeps riding while the
 * rider reads chat or picks a song.
 */
export function createOwnRide(deps: {
	ride: { handOff(): Trainer | null; ride(next: Trainer): Promise<void> };
	live: { sendMetrics(payload: ReturnType<typeof wireMetrics>): void };
	profile: {
		readonly current: {
			ftp: number;
			shareHr: boolean;
			sprintGrade: number;
			singleSpeed: boolean;
			kg: number;
		};
	};
	joined: () => boolean;
	/** The free ride this one replaces, saved first as joining a session does. */
	endFreeRide: () => Promise<unknown>;
}) {
	let session = $state<RideSession | null>(null);
	let workout = $state<Workout | null>(null);
	let error = $state<string | null>(null);
	let saving = $state(false);
	let outcome = $state<OwnRideOutcome | null>(null);
	let noCrashSafety = $state(false);
	let buffer: RideBuffer | undefined;
	let borrowed: Trainer | null = null;
	let saved = false;

	/** The trainer goes back to the channel, still paired, for the free ride or the session. */
	function giveBack() {
		const trainer = borrowed;
		borrowed = null;
		if (trainer) void deps.ride.ride(trainer);
	}

	async function save(
		current: RideSession,
		rode: Workout,
		back = true,
	): Promise<OwnRideOutcome | null> {
		if (saved) return null;
		saved = true;
		if (back) giveBack();
		else borrowed = null;
		const ended = buffer;
		buffer = undefined;
		if (current.recording.length === 0) {
			ended?.end();
			outcome = { nothing: true };
			return outcome;
		}
		saving = true;
		const result = await uploadRide(
			recordingUpload(rode, current.startedAt, current.recording),
		);
		saving = false;
		if ('saved' in result) {
			ended?.end();
			outcome = { saved: result.saved.id || null };
			return outcome;
		}
		// Kept in the crash buffer unless the server will refuse it again, so
		// Ride offers it back (#794, #2617).
		if (result.failure.final) ended?.end();
		else ended?.release();
		outcome = { failure: result.failure };
		return outcome;
	}

	$effect(() => {
		if (session?.state === 'done' && workout) void save(session, workout);
	});
	// Joining the session saves this ride first (ADR-0059). On the step in,
	// not on being in: the roster says "in" for a tick after Leave the ride.
	let wasJoined = false;
	$effect(() => {
		const now = deps.joined();
		if (now && !wasJoined && session && session.state !== 'done')
			session.stop();
		wasJoined = now;
	});

	return {
		/** The ride, from the count-in to its summary; null when there is none. */
		get session() {
			return session;
		},
		get workout() {
			return workout;
		},
		/** Why it could not start: persistent, beside the picker's way back in. */
		get error() {
			return error;
		},
		get saving() {
			return saving;
		},
		get outcome() {
			return outcome;
		},
		get noCrashSafety() {
			return noCrashSafety;
		},
		/** It holds the channel's trainer: counting in or riding. */
		get riding() {
			return !!session && session.state !== 'done';
		},
		async start(next: Workout) {
			if (session && session.state !== 'done') return;
			error = null;
			outcome = null;
			saved = false;
			await deps.endFreeRide();
			const trainer = deps.ride.handOff();
			if (!trainer) {
				error =
					'Pair your trainer first: the workout needs something to hold its targets.';
				return;
			}
			borrowed = trainer;
			const startedAt = Date.now();
			try {
				buffer = await openRideBuffer({
					rideId: String(startedAt),
					ownerId: account.me?.id,
					startedAt,
					workoutName: next.name,
					workoutJson: JSON.stringify(byReference(next)),
					...(next.road && { routeId: next.road.routeId }),
				});
				noCrashSafety = !buffer.crashSafe;
				const profile = deps.profile.current;
				const ride = createRideSession({
					trainer,
					workout: next,
					ftp: profile.ftp,
					kg: () => deps.profile.current.kg,
					startedAt,
					readings: () => sensors.readings,
					sprint: () => ({
						grade: deps.profile.current.sprintGrade,
						singleSpeed: deps.profile.current.singleSpeed,
					}),
					onRecord: (sample) => {
						buffer?.append({
							...sample,
							seq: sample.second + 1,
							at: Date.now(),
						});
						// Your numbers, as a free ride's go to the call (ADR-0059).
						deps.live.sendMetrics(
							wireMetrics(
								{ ...sample, from: {} },
								deps.profile.current.shareHr,
								sample.bias,
								sample.released,
							),
						);
					},
				});
				workout = next;
				session = ride;
				await ride.start();
			} catch (cause) {
				session = null;
				workout = null;
				buffer?.end();
				buffer = undefined;
				giveBack();
				error = pairError(cause);
			}
		},
		/** Changed their mind during the count-in (#1800): nothing ridden, nothing saved. */
		cancel() {
			const back = session?.abort();
			if (back) borrowed = back;
			session = null;
			workout = null;
			buffer?.end();
			buffer = undefined;
			giveBack();
		},
		/**
		 * Leaving the channel ends it and saves it — the rider left the
		 * channel, not the ride. The trainer goes with the channel, not back
		 * to it; its answer arrives after the page has gone.
		 */
		leave(): Promise<OwnRideOutcome | null> {
			if (!session || session.state === 'done' || !workout)
				return Promise.resolve(null);
			session.stop();
			return save(session, workout, false);
		},
		/** Off the summary and back to the channel's free ride. */
		dismiss() {
			if (session && session.state !== 'done') return;
			session = null;
			workout = null;
			outcome = null;
			error = null;
		},
	};
}

export type OwnRide = ReturnType<typeof createOwnRide>;
