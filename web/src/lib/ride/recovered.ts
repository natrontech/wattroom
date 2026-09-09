/**
 * Turning a ride the browser buffered but never finished into something the
 * server will take (#1057).
 *
 * Two endpoints, two shapes, and the difference between them is exactly the
 * kind of field rename that breaks silently: the .fit export wants a `second`
 * per sample and spells the strap `heartRate`, while the ride upload wants
 * neither the index nor that spelling. Both were inline in the ride screen with
 * nothing checking them.
 */
import type { BufferedSample, RideMeta } from './buffer';

export type RecoveredRide = RideMeta & { samples: BufferedSample[] };

/** POST /api/rides/export — the .fit encoder wants an explicit second per row. */
export function exportPayload(ride: RecoveredRide) {
	return {
		startedAt: new Date(ride.startedAt).toISOString(),
		samples: ride.samples.map((sample, index) => ({
			second: index,
			watts: sample.watts,
			cadence: sample.cadence,
			heartRate: sample.heartRate,
		})),
	};
}

/**
 * The ride upload. Only offered when the buffer carries the workout JSON —
 * a ride buffered before #794 has none, and an offer you cannot act on is not
 * an offer.
 */
export function uploadPayload(ride: RecoveredRide) {
	if (!ride.workoutJson) return null;
	return {
		workoutName: ride.workoutName,
		workoutJson: ride.workoutJson,
		startedAt: new Date(ride.startedAt).toISOString(),
		samples: ride.samples.map((sample) => ({
			watts: sample.watts,
			cadence: sample.cadence,
			hr: sample.heartRate,
			bias: sample.bias,
		})),
	};
}

/** The filename a rider gets: the day the ride happened, not the day they saved it. */
export function exportFilename(ride: RecoveredRide): string {
	const day = new Date(ride.startedAt).toISOString().slice(0, 10);
	return `wattroom-recovered-${day}.fit`;
}
