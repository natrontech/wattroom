import type { Trainer } from '$lib/ble/trainer';
import { hwlog } from '$lib/ble/hwlog';
import { account } from '$lib/account.svelte';
import { channelConnection } from '$lib/channel/connection.svelte';
import { createProfileStore } from '$lib/profile.svelte';
import { createRideFlags } from '$lib/ride/flags.svelte';
import { openRideBuffer, type RideBuffer } from '$lib/ride/buffer';
import { holdRoadAlone, type RoadAlone } from '$lib/ride/road-alone.svelte';
import type { RideableRoute } from '$lib/ride/roads';
import { saveRideAlone } from '$lib/ride/ride-alone-save';
import { createRideSounds, soloRideSounds } from '$lib/ride/ride-sounds.svelte';
import { soloTrainer } from '$lib/ride/solo-trainer.svelte';
import { sensors } from '$lib/sensors.svelte';
import { openRoad } from '$lib/workout/ridden';
import { byReference } from '$lib/workout/road-workout';
import { createRideSession } from '$lib/workout/session.svelte';
import { createSignalWatch } from '$lib/workout/signal-watch.svelte';
import type { Workout } from '$lib/workout/types';

type Session = ReturnType<typeof createRideSession>;

/**
 * The device's one ride alone (ADR-0093, #4259): owned here, above the
 * router, the way `channelConnection` holds the call, so the page that draws
 * it is a view of it and never its owner. A workout is a session, with its
 * crash buffer, the ⚑, the cues and the save; a free ride on a road is
 * `road`. /ride and a voice channel's Training page draw it.
 */
let session = $state<Session | null>(null);
let road = $state.raw<RoadAlone | null>(null);
let noCrashSafety = $state(false);
let saving = $state(false);
// The save's outcome is persistent status (errors.md); an export or a flag
// failing must not overwrite it (audit 2026-09-09).
let saveStatus = $state<string | null>(null);
// The same upload again, while a save failed and could still go through
// (#2618): the endpoint is idempotent, and the payload is still here.
let retrySave = $state<(() => void) | null>(null);
// The ride on the account, once it is: the summary's way forward (#1331).
let savedId = $state<string | null>(null);
let savedXp = $state<number | undefined>(undefined);
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

type Root = {
	flags: ReturnType<typeof createRideFlags>;
	signal: ReturnType<typeof createSignalWatch>;
};
let root: Root | null = null;

/** The ride's own effects, made once, on the first ride: nothing runs before. */
function ensureRoot(): Root {
	if (root) return root;
	$effect.root(() => {
		// The ⚑ and what it sends afterwards (#52), shared with /ramp.
		const flags = createRideFlags('/ride');
		const signal = createSignalWatch(() => session);
		root = { flags, signal };

		// What the ride says out loud (#1792): the cues a session plays for its
		// riders, from the session's own state, the same wiring as /ramp's (#3359).
		createRideSounds(
			soloRideSounds(
				() => session,
				() => signal.lost,
			),
		);

		// Guard telemetry for #46: the hardware session has to produce evidence,
		// not an anecdote. Dev-only via hwlog.
		let sawSpiral = false;
		let sawState: string | null = null;
		$effect(() => {
			const current = session;
			if (!current) return;
			if (current.spiralActive !== sawSpiral) {
				sawSpiral = current.spiralActive;
				hwlog('spiral-guard', {
					active: sawSpiral,
					watts: current.sample?.watts,
					cadence: current.sample?.cadence,
					target: current.target,
					elapsed: current.elapsed,
				});
			}
			if (current.state !== sawState) {
				sawState = current.state;
				hwlog('ride-state', { state: sawState, elapsed: current.elapsed });
			}
		});

		// Navigation never ends the ride (ADR-0093), but a closed tab does: the
		// browser asks first while there is a ride to lose (#126). The count-in
		// has nothing ridden yet (#1800). A closed tab sends the flags on its
		// way out (#2619).
		$effect(() => {
			const unload = (event: BeforeUnloadEvent) => {
				const state = session?.state;
				if (
					(state &&
						state !== 'idle' &&
						state !== 'countdown' &&
						state !== 'done') ||
					road?.solo.trainer
				)
					event.preventDefault();
			};
			const hide = () => flags.flush(true);
			window.addEventListener('beforeunload', unload);
			window.addEventListener('pagehide', hide);
			return () => {
				window.removeEventListener('beforeunload', unload);
				window.removeEventListener('pagehide', hide);
			};
		});

		// A finished ride is worth keeping even if the rider never exports it:
		// on the account (#110, one history feeding streaks and XP), with the
		// device store as the fallback when the server is unreachable.
		$effect(() => {
			if (session?.state === 'done') save(session);
		});
	});
	return root!;
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
	session = null;
}

function save(current: Session) {
	if (recorded || !root) return;
	recorded = true;
	const mine = ride;
	saveRideAlone(
		current,
		{ buffer, borrowed, ftp: profile.current.ftp },
		{
			current: () => mine === ride,
			seen: () => shown > 0,
			saving: (on) => {
				saving = on;
				if (on) retrySave = null;
			},
			status: (text, retry) => {
				saveStatus = text;
				retrySave = retry;
			},
			saved: (id, xp) => {
				savedId = id;
				savedXp = xp;
			},
		},
	);
}

export const theRide = {
	get session() {
		return session;
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
		return saving;
	},
	get saveStatus() {
		return saveStatus;
	},
	get retrySave() {
		return retrySave;
	},
	get savedId() {
		return savedId;
	},
	get savedXp() {
		return savedXp;
	},
	get flags() {
		return ensureRoot().flags;
	},

	/**
	 * Start a workout on `trainer`. Throws what stopped it; the ride is then
	 * gone and the trainer is the solo slot's again.
	 */
	async begin(
		trainer: Trainer,
		workout: Workout,
		options: { borrowed: boolean },
	): Promise<void> {
		const { flags } = ensureRoot();
		take(trainer);
		profile = createProfileStore();
		saving = false;
		saveStatus = null;
		retrySave = null;
		savedId = null;
		savedXp = undefined;
		recorded = false;
		borrowed = options.borrowed;
		try {
			// Crash safety (#19): every recorded sample also lands in IndexedDB,
			// so a browser crash at minute 55 still has a ride to export.
			const startedAt = Date.now();
			buffer = await openRideBuffer({
				rideId: String(startedAt),
				ownerId: account.me?.id,
				startedAt,
				workoutName: workout.name,
				// Carried so a ride whose save failed can be saved from the
				// recovery card rather than only exported (#794).
				workoutJson: JSON.stringify(byReference(workout)),
				// A road workout's recovered ride saves against its route (#3499),
				// never a borrowed one, which has no route row (#3621, #4262).
				...(workout.road && !borrowed && { routeId: workout.road.routeId }),
			});
			noCrashSafety = !buffer.crashSafe;
			flags.riding(trainer.name, `starting ${workout.name}`);
			const next = createRideSession({
				trainer,
				workout,
				ftp: profile.current.ftp,
				kg: () => profile.current.kg,
				startedAt,
				readings: () => sensors.readings,
				// The rider's own sprint setup (#1529): a sprint block releases
				// the trainer to this slope, the way an armed sprint does in a
				// session. Read per sprint, so /settings lands mid-ride.
				sprint: () => ({
					grade: profile.current.sprintGrade,
					singleSpeed: profile.current.singleSpeed,
				}),
				onRecord: (sample) => {
					buffer?.append({ ...sample, seq: sample.second + 1, at: Date.now() });
					flags.recorder.tick({
						watts: sample.watts,
						cadence: sample.cadence,
						target: session?.target ?? 0,
						state: session?.state ?? '',
					});
				},
			});
			// On screen before the clock (#1800): start() counts in for three
			// seconds, and the page has to draw those seconds, which also takes
			// PreRide's Start button away, so there is no second tap to build a
			// second ride with.
			session = next;
			await next.start();
		} catch (cause) {
			session = null;
			buffer?.end();
			buffer = undefined;
			throw cause;
		}
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
		session = null;
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
		session = null;
	},

	/** A page that draws the ride mounted; the function it returns unmounts it. */
	showing(): () => void {
		shown++;
		return () => {
			shown--;
		};
	},
};
