import { MIN_SAMPLES, openRideBuffer, type RideBuffer } from '$lib/ride/buffer';
import { uploadRide, type RideUpload, type SaveFailure } from '$lib/ride/save';

/** docs/SPEC.md's free ride (ADR-0059) — defaults, tune in alpha. */
export const GRADE = { step: 0.5, min: -5, max: 15 } as const;
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
 */
export function createFreeRide(deps: { ftp: () => number }) {
	let armed = $state(false);
	let mode = $state<FreeMode>('grade');
	let grade = $state(0);
	let watts = $state<number | null>(null);
	let startedAt = $state<number | null>(null);
	let seconds = $state(0);
	let saving = $state(false);
	let outcome = $state<FreeRideOutcome | null>(null);
	let samples: RideUpload['samples'] = [];
	let rideId = '';
	let buffer: RideBuffer | null = null;

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
		/** Pedalled at least once since it was armed. */
		get recording() {
			return startedAt !== null;
		},
		get seconds() {
			return seconds;
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
			mode = next;
		},
		nudge(dir: 1 | -1) {
			if (mode === 'grade') grade = nudged('grade', grade, dir);
			else watts = nudged('watts', watts ?? openingWatts(deps.ftp()), dir);
		},
		/** One counted second from the trainer, while no session drives it. */
		second(sample: { watts: number; cadence: number; hr: number }) {
			if (!armed || (sample.watts <= 0 && sample.cadence <= 0)) return;
			if (startedAt === null) {
				startedAt = Date.now();
				outcome = null;
				samples = [];
				rideId = crypto.randomUUID();
				buffer = null;
				const opening = rideId;
				void openRideBuffer({
					rideId,
					startedAt,
					workoutName: FREE_RIDE_NAME,
					workoutJson: FREE_RIDE_JSON,
				}).then((opened) => {
					if (rideId === opening) buffer = opened;
				});
			}
			samples.push(sample);
			seconds = samples.length;
			buffer?.append({
				seq: samples.length,
				watts: sample.watts,
				cadence: sample.cadence,
				heartRate: sample.hr,
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
			};
			const ended = buffer;
			startedAt = null;
			seconds = 0;
			samples = [];
			// The buffer never offers a ride this short back either.
			if (ride.samples.length < MIN_SAMPLES) {
				ended?.end();
				outcome = { short: true };
				return outcome;
			}
			saving = true;
			const result = await uploadRide(ride);
			saving = false;
			if ('saved' in result) ended?.end();
			outcome = result;
			return result;
		},
	};
}

export type FreeRide = ReturnType<typeof createFreeRide>;
