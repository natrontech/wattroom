import { api } from '$lib/api';

/** A finished solo ride, in the shape POST /api/rides wants. */
export interface RideUpload {
	workoutName: string;
	workoutJson: string;
	/** ISO 8601. */
	startedAt: string;
	samples: { watts: number; cadence: number; hr: number }[];
}

/**
 * Save a finished solo ride to the account. One place, because there are two
 * ways in: the ride that just ended, and the retry of one that did not make it
 * the first time (#794).
 *
 * ponytail: no automatic retry behind this. The POST has no client ride key,
 * so a retry the rider did not ask for could duplicate a ride — make the
 * endpoint idempotent first, then a background retry is safe to add.
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

export async function uploadRide(
	ride: RideUpload,
): Promise<SaveFailure | null> {
	const res = await api('/api/rides', { method: 'POST', json: ride });
	if (res.ok) return null;
	return { message: res.error.message, final: FINAL.has(res.error.error) };
}
