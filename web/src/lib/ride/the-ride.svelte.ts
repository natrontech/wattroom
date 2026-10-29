import type { Trainer } from '$lib/ble/trainer';
import { channelConnection } from '$lib/channel/connection.svelte';
import { createProfileStore } from '$lib/profile.svelte';
import type { RideBuffer } from '$lib/ride/buffer';
import { holdRampAlone, type RampAlone } from '$lib/ride/ramp-alone.svelte';
import { holdRoadAlone, type RoadAlone } from '$lib/ride/road-alone.svelte';
import type { RideableRoute } from '$lib/ride/roads';
import { holdRideAloneEffects } from '$lib/ride/ride-alone-effects.svelte';
import { saveRideAlone } from '$lib/ride/ride-alone-save';
import {
	createWorkoutAlone,
	openWorkoutBuffer,
} from '$lib/ride/ride-alone-session';
import { createSaveOutcome } from '$lib/ride/save-outcome.svelte';
import { soloTrainer } from '$lib/ride/solo-trainer.svelte';
import { buildRampTest } from '$lib/workout/ramp';
import { openRoad } from '$lib/workout/ridden';
import { byReference } from '$lib/workout/road-workout';
import type { createRideSession } from '$lib/workout/session.svelte';
import type { Workout } from '$lib/workout/types';

type Session = ReturnType<typeof createRideSession>;

/**
 * The device's one ride alone (ADR-0093, #4259): owned here, above the
 * router, the way `channelConnection` holds the call, so the page that draws
 * it is a view of it and never its owner. A workout is a session, with its
 * crash buffer, the ⚑, the cues and the save; the ramp test is a workout
 * that is also `ramp`; a free ride on a road is `road`. /ride, /ramp and a
 * voice channel's Training page draw it.
 */
let session = $state<Session | null>(null);
let ramp = $state.raw<RampAlone | null>(null);
let road = $state.raw<RoadAlone | null>(null);
let noCrashSafety = $state(false);
const outcome = createSaveOutcome();
// How many pages draw the ride now: a save that answers with none of them
// open has no summary to land on, so its outcome becomes a toast (#1544).
// Not $state: nothing renders it, and the effect that counts a page must not
// read what it writes.
let shown = 0;
// Which ride the summary is: a save that answers after the next ride began
// keeps its answer to a toast and leaves that ride's summary alone.
let ride = 0;
// The rider's FTP, weight and sprint setup, read when the ride starts, as the
// page that owned it read them when it opened (ADR-0009: the account is the
// truth, and the root layout pulls it into this store's storage).
let profile = createProfileStore();

let buffer: RideBuffer | undefined;
let recorded = false;
// One of WattRoom's roads (#4248): ridden, never saved against (#4262).
let borrowed = false;

let root: ReturnType<typeof holdRideAloneEffects> | null = null;

/** The ride's own effects, made once, on the first ride: nothing runs before. */
function ensureRoot() {
	root ??= holdRideAloneEffects({
		session: () => session,
		road: () => road,
		save,
	});
	return root;
}

/**
 * One trainer, one ride (#521): a voice channel holds the trainer's BLE
 * connection while you stand in it, so the ride takes it back rather than
 * open a second control channel to the same hardware. A trainer paired in
 * the solo slot and then left for another is the same conflict. The last
 * ride's summary goes with it.
 */
function take(trainer: Trainer) {
	ride++;
	channelConnection.current?.ride.unpair();
	const solo = soloTrainer();
	if (solo.trainer && solo.trainer !== trainer) solo.forget();
	road?.dispose();
	road = null;
	drop();
}

/** The workout let go, the ramp's hold with it. */
function drop() {
	ramp?.dispose();
	ramp = null;
	session = null;
}

function save(current: Session) {
	if (recorded || !root) return;
	recorded = true;
	const mine = ride;
	saveRideAlone(
		current,
		{ buffer, borrowed, ftp: profile.current.ftp },
		outcome.answers(
			() => mine === ride,
			() => shown > 0,
		),
	);
}

async function startWorkout(
	trainer: Trainer,
	workout: Workout,
	options: { borrowed: boolean; ramp?: boolean },
): Promise<void> {
	// One ride per device (ADR-0093): no Start is drawn while one runs.
	if (theRide.live) return;
	const { flags } = ensureRoot();
	take(trainer);
	profile = createProfileStore();
	outcome.reset();
	recorded = false;
	borrowed = options.borrowed;
	try {
		const startedAt = Date.now();
		buffer = await openWorkoutBuffer(workout, { borrowed, startedAt });
		noCrashSafety = !buffer.crashSafe;
		if (options.ramp)
			flags.riding(trainer.name, 'starting the ramp test', '/ramp');
		else flags.riding(trainer.name, `starting ${workout.name}`);
		const next = createWorkoutAlone({
			trainer,
			workout,
			profile,
			startedAt,
			buffer: () => buffer,
			flags,
			session: () => session,
		});
		// On screen before the clock (#1800): start() counts in for three
		// seconds, and the page has to draw those seconds, which also takes
		// PreRide's Start button away, so there is no second tap to build a
		// second ride with.
		session = next;
		if (options.ramp)
			ramp = holdRampAlone({ session: next, savedId: () => outcome.id });
		await next.start();
	} catch (cause) {
		drop();
		buffer?.end();
		buffer = undefined;
		throw cause;
	}
}

export const theRide = {
	get session() {
		return session;
	},
	/** The ramp test's own half, while the workout is one. */
	get ramp() {
		return ramp;
	},
	/** A free ride on a road, riding or on its closing card. */
	get road() {
		return road;
	},
	/** Live: counting in or riding, not yet summarised. */
	get live() {
		return (
			(!!session && session.state !== 'idle' && session.state !== 'done') ||
			!!road?.solo.trainer
		);
	},
	/** A ride to draw: under way, or its summary. */
	get held() {
		return !!session || !!road;
	},
	get signalLost() {
		return root?.signal.lost ?? false;
	},
	get noCrashSafety() {
		return noCrashSafety;
	},
	get saving() {
		return outcome.saving;
	},
	get saveStatus() {
		return outcome.status;
	},
	get retrySave() {
		return outcome.retry;
	},
	get savedId() {
		return outcome.id;
	},
	get savedXp() {
		return outcome.xp;
	},
	get flags() {
		return ensureRoot().flags;
	},

	/**
	 * Start a workout on `trainer`. Throws what stopped it; the ride is then
	 * gone and the trainer is the solo slot's again.
	 */
	begin(trainer: Trainer, workout: Workout, options: { borrowed: boolean }) {
		return startWorkout(trainer, workout, options);
	},

	/** The ramp test (#14), a workout that ends itself and measures FTP. */
	beginRamp(trainer: Trainer) {
		return startWorkout(trainer, buildRampTest(), {
			borrowed: false,
			ramp: true,
		});
	},

	/**
	 * A free ride on `route` alone (#3027), from `from` metres, recording from
	 * the first stroke: a free ride has no count-in (docs/SPEC.md).
	 */
	beginRoad(trainer: Trainer, route: RideableRoute, from: number) {
		if (theRide.live) return;
		const { flags } = ensureRoot();
		take(trainer);
		road = holdRoadAlone({ route, from, trainer, flags });
	},

	/**
	 * Changed their mind during the count-in (#1800). Nothing was ridden, so
	 * this is not an End: back to the setup with the trainer still paired,
	 * handed back to the slot Start took it from (#2615), and no zero-sample
	 * ride is filed.
	 */
	cancelCountdown() {
		soloTrainer().adopt(session?.abort());
		drop();
		buffer?.end();
		buffer = undefined;
	},

	/**
	 * Change workout (#4257): the pick from its first block, on the road where
	 * the dot is, or, with none, the road on at its own grade. The ride, its
	 * recording and its place carry on in the session.
	 */
	changeWorkout(next: Workout | null) {
		const on = session?.road;
		if (!session || (!next && !on)) return;
		const road = on && { routeId: on.routeId, fromM: on.m, toM: on.toM };
		session.changeWorkout(
			road ? (next ? { ...next, road } : openRoad(road)) : next!,
		);
		root?.flags.recorder.event('ride', `changed to ${session.workout.name}`);
		const planned = session.planned;
		buffer?.retitle({
			workoutName: planned.name,
			workoutJson: JSON.stringify(byReference(planned)),
		});
	},

	/**
	 * The rider walked away from the summary: the next riding screen opens on
	 * the setup. What they flagged goes with them (#2619). A ride still
	 * running is not touched: only End ride ends it.
	 */
	dismiss() {
		if (road?.ended) {
			root?.flags.flush();
			road.dispose();
			road = null;
		}
		if (session?.state !== 'done') return;
		root?.flags.flush();
		drop();
	},

	/** A page that draws the ride mounted; the function it returns unmounts it. */
	showing(): () => void {
		shown++;
		return () => {
			shown--;
		};
	},
};
