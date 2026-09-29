import { account } from '$lib/account.svelte';
import { api } from '$lib/api';

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
	workout: { name: string },
	startedAt: Date,
	recording: readonly {
		watts: number;
		cadence: number;
		heartRate: number;
		bias: number;
		clock: number;
		released: boolean;
	}[],
): RideUpload {
	return {
		workoutName: workout.name,
		workoutJson: JSON.stringify(workout),
		startedAt: startedAt.toISOString(),
		samples: recording.map((sample) => ({
			watts: sample.watts,
			cadence: sample.cadence,
			hr: sample.heartRate,
			bias: sample.bias,
			clock: sample.clock,
			released: sample.released,
		})),
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

/** Null on success — or the saved ride, so the summary can link to it (#1331). */
export async function uploadRide(
	ride: RideUpload,
): Promise<{ saved: { id: string } } | { failure: SaveFailure }> {
	const res = await api<{ id?: string }>('/api/rides', {
		method: 'POST',
		json: ride,
	});
	if (res.ok) {
		// A saved ride can move what the account suggests — an FTP, an LTHR —
		// and /api/me is where those ride (#2626): re-read it now, so the
		// prompt follows the ride that earned it rather than the next reload.
		void account.load();
		return { saved: { id: String(res.data?.id ?? '') } };
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
