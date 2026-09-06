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
export async function uploadRide(ride: RideUpload): Promise<string | null> {
	const res = await api('/api/rides', { method: 'POST', json: ride });
	return res.ok ? null : res.error.message;
}
