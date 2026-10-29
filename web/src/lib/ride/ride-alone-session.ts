import type { Trainer } from '$lib/ble/trainer';
import { account } from '$lib/account.svelte';
import type { createProfileStore } from '$lib/profile.svelte';
import { openRideBuffer, type RideBuffer } from '$lib/ride/buffer';
import type { createRideFlags } from '$lib/ride/flags.svelte';
import { sensors } from '$lib/sensors.svelte';
import { byReference } from '$lib/workout/road-workout';
import { createRideSession } from '$lib/workout/session.svelte';
import type { Workout } from '$lib/workout/types';

type Session = ReturnType<typeof createRideSession>;

/**
 * Crash safety (#19): every recorded sample of a workout alone also lands in
 * IndexedDB, so a browser crash at minute 55 still has a ride to export.
 */
export function openWorkoutBuffer(
	workout: Workout,
	{ borrowed, startedAt }: { borrowed: boolean; startedAt: number },
): Promise<RideBuffer> {
	return openRideBuffer({
		rideId: String(startedAt),
		ownerId: account.me?.id,
		startedAt,
		workoutName: workout.name,
		// Carried so a ride whose save failed can be saved from the recovery
		// card rather than only exported (#794).
		workoutJson: JSON.stringify(byReference(workout)),
		// A road workout's recovered ride saves against its route (#3499),
		// never a borrowed one, which has no route row (#3621, #4262).
		...(workout.road && !borrowed && { routeId: workout.road.routeId }),
	});
}

/** A workout alone on `trainer`, recording into the buffer and the ⚑'s recorder. */
export function createWorkoutAlone(deps: {
	trainer: Trainer;
	workout: Workout;
	profile: ReturnType<typeof createProfileStore>;
	startedAt: number;
	buffer: () => RideBuffer | undefined;
	flags: ReturnType<typeof createRideFlags>;
	session: () => Session | null;
}): Session {
	const { profile, flags } = deps;
	return createRideSession({
		trainer: deps.trainer,
		workout: deps.workout,
		ftp: profile.current.ftp,
		kg: () => profile.current.kg,
		startedAt: deps.startedAt,
		readings: () => sensors.readings,
		// The rider's own sprint setup (#1529): a sprint block releases the
		// trainer to this slope, the way an armed sprint does in a session.
		// Read per sprint, so /settings lands mid-ride.
		sprint: () => ({
			grade: profile.current.sprintGrade,
			singleSpeed: profile.current.singleSpeed,
		}),
		onRecord: (sample) => {
			deps
				.buffer()
				?.append({ ...sample, seq: sample.second + 1, at: Date.now() });
			const session = deps.session();
			flags.recorder.tick({
				watts: sample.watts,
				cadence: sample.cadence,
				target: session?.target ?? 0,
				state: session?.state ?? '',
			});
		},
	});
}
