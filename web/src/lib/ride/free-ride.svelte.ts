import { account } from '$lib/account.svelte';
import { MaxTrainerGrade, MinRideSamples } from '$lib/protocol';
import { ergByRoad, ROAD } from '$lib/ride/ride-grade';
import { gearsEnabled } from '$lib/ride/gears-enabled';
import { createRoadRide, type RoadSecond } from '$lib/ride/road-ride';
import type { RideableRoute } from '$lib/ride/roads';
import { openRideBuffer, type RideBuffer } from '$lib/ride/buffer';
import { createLiveStats } from '$lib/ride/live-stats.svelte';
import { uploadRide, type RideUpload, type SaveFailure } from '$lib/ride/save';
import { DEFAULTS } from '$lib/workout/guards';

/**
 * docs/SPEC.md's free ride (ADR-0059) — defaults, tune in alpha. Its grade
 * range is the felt grade's: the felt floor, and ADR-0062's one ceiling.
 */
export const GRADE = {
	step: 0.5,
	min: ROAD.feltMin,
	max: MaxTrainerGrade,
} as const;
export const WATTS = { step: 10, min: 50, max: 1000 } as const;
const OPENING_FTP_FRACTION = 0.55;

/** The empty, unscored workout a free ride saves as — a game's shape. */
export const FREE_RIDE_NAME = 'Free ride';
export const FREE_RIDE_JSON = JSON.stringify({
	name: FREE_RIDE_NAME,
	unscored: true,
	steps: [],
});

export type FreeMode = 'grade' | 'watts';
export type FreeRideOutcome =
	{ saved: { id: string } } | { failure: SaveFailure } | { short: true };

const clamp = (value: number, { min, max }: { min: number; max: number }) =>
	Math.min(max, Math.max(min, value));

/** Where watts mode opens: an easy spin, on the 10 W grid. */
export function openingWatts(ftp: number): number {
	return clamp(
		Math.round((OPENING_FTP_FRACTION * ftp) / WATTS.step) * WATTS.step,
		WATTS,
	);
}

/** One press of − or +, snapped to the mode's grid and held in its bounds. */
export function nudged(mode: FreeMode, value: number, dir: 1 | -1): number {
	const range = mode === 'grade' ? GRADE : WATTS;
	const next = Math.round((value + dir * range.step) / range.step) * range.step;
	return clamp(next, range);
}

/**
 * A free ride (ADR-0059): riding a voice channel with no session and no
 * workout. Lives on the channel connection beside the trainer, so it keeps
 * recording while the rider reads chat or picks a song.
 *
 * Armed by opening the Free ride surface, never by pedalling: a warm-up in
 * the Lounge before a session is not a ride of its own, and saving it would
 * put one on Strava. It records the seconds the rider pedals — a rest is not
 * ride time, as auto-paused time is not (docs/SPEC.md) — and it is kept in
 * the crash buffer, so a ride that never reaches End ride is offered back.
 *
 * It opens in grade, except on a one-gear setup (`singleSpeed`), where the
 * slope has no usable range and it opens in watts (#3203). Read when asked,
 * not when created: the profile arrives after the connection does.
 */
export function createFreeRide(deps: {
	ftp: () => number;
	singleSpeed?: () => boolean;
	/** The rider's weight, kg: a road's dot carries it (#3027). */
	kg?: () => number;
}) {
	let armed = $state(false);
	/** The mode the rider picked; null until they pick one. */
	let picked = $state<FreeMode | null>(null);
	const mode = $derived<FreeMode>(
		picked ?? (deps.singleSpeed?.() ? 'watts' : 'grade'),
	);
	let grade = $state(0);
	let watts = $state<number | null>(null);
	let startedAt = $state<number | null>(null);
	let seconds = $state(0);
	let saving = $state(false);
	let outcome = $state<FreeRideOutcome | null>(null);
	let samples: RideUpload['samples'] = [];
	// The bike computer's numbers (#3068, #3088): no blocks and no target —
	// a free ride is unscored — so its block numbers are the ride's.
	const live = createLiveStats(deps.ftp);
	let rideId = '';
	let buffer: RideBuffer | null = null;
	// A road is an attribute of the free ride, not a mode (#3027, decided
	// 2026-09-28): Grade reads Road on one, and Watts rides ERG by the road.
	let onRoad = $state.raw<{
		route: RideableRoute;
		ride: ReturnType<typeof createRoadRide>;
	} | null>(null);
	let here = $state.raw<RoadSecond | null>(null);
	const road = $derived(
		onRoad && here
			? {
					id: onRoad.route.id,
					name: onRoad.route.name,
					length: onRoad.route.road.length,
					...here,
				}
			: null,
	);

	return {
		get armed() {
			return armed;
		},
		get mode() {
			return mode;
		},
		get grade() {
			return grade;
		},
		get watts() {
			return watts ?? openingWatts(deps.ftp());
		},
		/** The road under the ride, and where on it; null off a road. */
		get road() {
			return road;
		},
		/**
		 * The watts the trainer holds: the rider's own in watts mode, or on a
		 * road the road's (ERG by the road, docs/SPEC.md); none in grade mode.
		 */
		get targetWatts() {
			if (mode !== 'watts') return 0;
			return road
				? ergByRoad(deps.ftp(), road.roadPct)
				: (watts ?? openingWatts(deps.ftp()));
		},
		/** Pedalled at least once since it was armed. */
		get recording() {
			return startedAt !== null;
		},
		get seconds() {
			return seconds;
		},
		get live() {
			return live.current;
		},
		get saving() {
			return saving;
		},
		get outcome() {
			return outcome;
		},
		arm() {
			armed = true;
		},
		setMode(next: FreeMode) {
			if (next === 'watts' && watts === null) watts = openingWatts(deps.ftp());
			picked = next;
		},
		/**
		 * Onto a road, before the ride starts: a ride saved against a route is
		 * ridden on it from its first second. `from` is a resumed ride's metre.
		 */
		ride(route: RideableRoute, from = 0) {
			if (startedAt !== null) return;
			const ride = createRoadRide(route.road, {
				kg: () => deps.kg?.() ?? 0,
				from,
			});
			onRoad = { route, ride };
			here = ride.second(0, Date.now());
		},
		/** Off the road again, before the ride starts. */
		leaveRoad() {
			if (startedAt !== null) return;
			onRoad = null;
			here = null;
		},
		nudge(dir: 1 | -1) {
			if (mode === 'grade') grade = nudged('grade', grade, dir);
			else watts = nudged('watts', watts ?? openingWatts(deps.ftp()), dir);
		},
		/** One counted second from the trainer, while no session drives it. */
		second(sample: {
			watts: number;
			cadence: number;
			hr: number;
			/** On a road, the dot's speed: a coasted descent is ridden (#3056). */
			virtualMps?: number;
			/** ms epoch; the road's dot moves by the time between samples. */
			at?: number;
		}) {
			// On a road the dot moves first: whether this second counts reads
			// its speed, and the trainer's next grade is read where it lands.
			if (armed && onRoad)
				here = onRoad.ride.second(sample.watts, sample.at ?? Date.now());
			const virtualMps = here?.virtualMps ?? sample.virtualMps ?? 0;
			const rolling = virtualMps > DEFAULTS.ridingMps;
			if (!armed || (sample.watts <= 0 && sample.cadence <= 0 && !rolling))
				return;
			if (startedAt === null) {
				startedAt = Date.now();
				outcome = null;
				samples = [];
				live.reset();
				rideId = crypto.randomUUID();
				buffer = null;
				const opening = rideId;
				void openRideBuffer({
					rideId,
					ownerId: account.me?.id,
					startedAt,
					workoutName: FREE_RIDE_NAME,
					workoutJson: FREE_RIDE_JSON,
				}).then((opened) => {
					if (rideId === opening) buffer = opened;
					else opened.release();
				});
			}
			// The upload's own fields: its decoder refuses anything else.
			samples.push({
				watts: sample.watts,
				cadence: sample.cadence,
				hr: sample.hr,
				...(here && { m: here.m, alt: here.alt }),
			});
			seconds = samples.length;
			live.push({ watts: sample.watts });
			buffer?.append({
				seq: samples.length,
				watts: sample.watts,
				cadence: sample.cadence,
				heartRate: sample.hr,
				...(here && { m: here.m }),
				at: Date.now(),
			});
		},
		/**
		 * End ride: disarms, and saves what was ridden — or lets a misclick go,
		 * under docs/SPEC.md's minute. A failed save stays in the crash buffer,
		 * which is what offers it back.
		 */
		async end(): Promise<FreeRideOutcome | null> {
			armed = false;
			if (startedAt === null || saving) return null;
			const ride: RideUpload = {
				workoutName: FREE_RIDE_NAME,
				workoutJson: FREE_RIDE_JSON,
				startedAt: new Date(startedAt).toISOString(),
				samples,
				...(onRoad && {
					routeId: onRoad.route.id,
					drive:
						mode === 'watts'
							? ('ergByRoad' as const)
							: gearsEnabled()
								? ('gears' as const)
								: ('sim' as const),
				}),
			};
			const ended = buffer;
			startedAt = null;
			seconds = 0;
			samples = [];
			// The buffer never offers a ride this short back either.
			if (ride.samples.length < MinRideSamples) {
				ended?.end();
				outcome = { short: true };
				return outcome;
			}
			saving = true;
			const result = await uploadRide(ride);
			saving = false;
			if ('saved' in result) ended?.end();
			// Not saved and no longer recorded: a ride to offer back (#2617).
			else ended?.release();
			outcome = result;
			return result;
		},
	};
}

export type FreeRide = ReturnType<typeof createFreeRide>;
