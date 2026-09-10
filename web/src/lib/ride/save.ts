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
	}[];
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
	 * The server looked at the ride and said no — under a minute, malformed —
	 * so a retry can only be refused again. An outage or a 5xx is not final.
	 */
	final: boolean;
}

const FINAL = new Set(['validation_error', 'invalid_request']);

/** Null on success — or the saved ride, so the summary can link to it (#1331). */
export async function uploadRide(
	ride: RideUpload,
): Promise<{ saved: { id: string } } | { failure: SaveFailure }> {
	const res = await api<{ id?: string }>('/api/rides', {
		method: 'POST',
		json: ride,
	});
	if (res.ok) return { saved: { id: String(res.data?.id ?? '') } };
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
