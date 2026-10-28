import { account } from '$lib/account.svelte';
import { api } from '$lib/api';
import { byReference } from '$lib/workout/road-workout';
import type { Workout } from '$lib/workout/types';

/** A finished solo ride, in the shape POST /api/rides wants. */
export interface RideUpload {
	workoutName: string;
	workoutJson: string;
	/** ISO 8601. */
	startedAt: string;
	samples: {
		watts: number;
		cadence: number;
		hr: number;
		bias?: number;
		clock?: number;
		released?: boolean;
		/** On a road (#3052): metres along it, and the height there. */
		m?: number;
		alt?: number;
		/** Its lap, and on a lap's first sample which way it runs (#3598). */
		lap?: number;
		reverse?: boolean;
	}[];
	/** The stored route a ride on a road rode (#3053): one of the rider's own. */
	routeId?: string;
	/** How the trainer was driven along it (#3516): sim, gears or ergByRoad. */
	drive?: 'sim' | 'gears' | 'ergByRoad';
}

/**
 * A solo ride as the account takes it: the workout it rode and every recorded
 * second — the trim it was ridden at (#1530), the workout second (#1733) and
 * the guard's own seconds (#1796), which the server scores by. One mapping for
 * /ride and a voice channel's own workout (#2329).
 */
export function recordingUpload(
	workout: Workout,
	startedAt: Date,
	recording: readonly {
		watts: number;
		cadence: number;
		heartRate: number;
		bias: number;
		clock: number;
		released: boolean;
		m?: number;
		alt?: number;
		lap?: number;
		reverse?: boolean;
	}[],
	/** Ridden on a borrowed road, which has no route row to save against (#3621, #4262). */
	{ borrowed = false }: { borrowed?: boolean } = {},
): RideUpload {
	// A road workout's ride saves against its route (#3499): the metres it
	// rode, and ERG by the road, since WattRoom chose the watts (#3516).
	const onRoad =
		!!workout.road && !borrowed && recording.some((s) => s.m !== undefined);
	return {
		workoutName: workout.name,
		// By reference: the server refuses a road sent back up (ADR-0063).
		workoutJson: JSON.stringify(byReference(workout)),
		startedAt: startedAt.toISOString(),
		samples: recording.map((sample) => ({
			watts: sample.watts,
			cadence: sample.cadence,
			hr: sample.heartRate,
			bias: sample.bias,
			// A road workout's clock is metres along the road, so a fraction; the
			// server keys the score on the whole second (rides.sampleJSON.Clock).
			clock: Math.floor(sample.clock),
			released: sample.released,
			...(sample.m !== undefined && { m: sample.m, alt: sample.alt }),
			...(sample.lap && { lap: sample.lap }),
			...(sample.reverse && { reverse: true }),
		})),
		...(onRoad && {
			routeId: workout.road!.routeId,
			drive: 'ergByRoad' as const,
		}),
	};
}

/**
 * Save a finished solo ride to the account. One place, because there are two
 * ways in: the ride that just ended, and the retry of one that did not make it
 * the first time (#794).
 *
 * ponytail: no automatic retry behind this yet. The endpoint IS idempotent —
 * the server keys a ride on (rider, startedAt) under a row lock and hands the
 * existing id back — so a background retry for the "kept on this device" case
 * is safe to add when a rider asks for one.
 */
export interface SaveFailure {
	/** The server's own sentence (errors.md). */
	message: string;
	/**
	 * The server looked at the ride and said no — under a minute, malformed,
	 * or overlapping a ride already on the account (#3044) — so a retry can
	 * only be refused again. An outage or a 5xx is not final.
	 */
	final: boolean;
}

const FINAL = new Set(['validation_error', 'invalid_request', 'conflict']);

/** What a ride saved without its road says, wherever it lands (#4262). */
export const ROAD_LEFT_OFF =
	'Saved without its road, which is not one of your routes.';

const post = (ride: RideUpload) =>
	api<{ id?: string; xp?: number }>('/api/rides', {
		method: 'POST',
		json: ride,
	});

/** Null on success — or the saved ride, so the summary can link to it (#1331). */
export async function uploadRide(
	ride: RideUpload,
): Promise<
	| { saved: { id: string; xp?: number; roadLeftOff?: true } }
	| { failure: SaveFailure }
> {
	let res = await post(ride);
	// Refused over its road alone (#4262): a road the account holds no route
	// for, a mate's or one buffered before #4262. The seconds still save.
	const roadLeftOff =
		!res.ok && res.error.field === 'routeId' && !!ride.routeId;
	if (roadLeftOff)
		res = await post({ ...ride, routeId: undefined, drive: undefined });
	if (res.ok) {
		// A saved ride can move what the account suggests — an FTP, an LTHR —
		// and /api/me is where those ride (#2626): re-read it now, so the
		// prompt follows the ride that earned it rather than the next reload.
		void account.load();
		return {
			saved: {
				id: String(res.data?.id ?? ''),
				xp: res.data?.xp,
				...(roadLeftOff && { roadLeftOff: true as const }),
			},
		};
	}
	return {
		failure: { message: res.error.message, final: FINAL.has(res.error.error) },
	};
}

/**
 * Tell a ride which FTP it produced (#1572). Only the ramp calls this, and
 * only once the rider has accepted the number: the ride itself was saved the
 * moment the test ended, carrying the FTP it was SCORED against, so without
 * this the trend could not draw the ramp's own result until the next ride.
 *
 * Returns the server's sentence, or null. Never blocks the result screen —
 * the FTP is already on the account by the time this runs; all that is at
 * stake is a mark on a chart.
 */
export async function stampFtpAfter(
	rideId: string,
	ftp: number,
): Promise<string | null> {
	const res = await api(`/api/rides/${rideId}/ftp-after`, {
		method: 'PUT',
		json: { ftpAfter: ftp },
	});
	return res.ok ? null : res.error.message;
}
