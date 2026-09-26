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
import { confirm } from '$lib/confirm.svelte';
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
 * Whether the card may offer "Save to your account". A ride buffered before
 * #794 has no workout to save, and an offer you cannot act on is not an offer.
 * A ride buffered before #2805 names no rider, and filing it would put whoever
 * rode it — their heart rate included — into whoever is signed in now: it can
 * still be downloaded, never saved.
 */
export function canSave(
	ride: RecoveredRide,
): ride is RecoveredRide & { workoutJson: string; ownerId: string } {
	return !!ride.workoutJson && !!ride.ownerId;
}

/** The ride upload, for a ride the card may save. */
export function uploadPayload(ride: RecoveredRide) {
	if (!canSave(ride)) return null;
	return {
		workoutName: ride.workoutName,
		workoutJson: ride.workoutJson,
		startedAt: new Date(ride.startedAt).toISOString(),
		samples: ride.samples.map((sample) => ({
			watts: sample.watts,
			cadence: sample.cadence,
			hr: sample.heartRate,
			bias: sample.bias,
			clock: sample.clock,
			released: sample.released,
		})),
	};
}

/** The filename a rider gets: the day the ride happened, not the day they saved it. */
export function exportFilename(ride: RecoveredRide): string {
	const day = new Date(ride.startedAt).toISOString().slice(0, 10);
	return `wattroom-recovered-${day}.fit`;
}

/** Minutes recorded, as the card says it. */
export function recordedMinutes(ride: RecoveredRide): number {
	return Math.round(ride.samples.length / 60);
}

/**
 * What discarding takes, and the ways to keep it instead — only the ways the
 * card is actually offering: `canSave` decides whether "Save to your account"
 * renders at all. Naming a button that is not there is the same fault as
 * rendering one that will fail (errors.md).
 */
export function discardBody(ride: RecoveredRide): string {
	const keep = canSave(ride)
		? 'Save it to your account or download the .fit first'
		: 'Download the .fit first';
	return `“${ride.workoutName}”, ${recordedMinutes(ride)} min recorded — these samples are on this device and nowhere else, so discarding deletes the only copy. ${keep} if you want to keep it.`;
}

/**
 * The ask before a discard (errors.md, #1493). This is the file's original
 * confirm case rather than its third one — the samples are destroyed — and
 * /history's "Clear device rides" already asks the same question about the
 * same data; one card offering it in one click was the inconsistency.
 */
export function confirmDiscard(ride: RecoveredRide): Promise<boolean> {
	return confirm({
		title: 'Discard the recovered ride?',
		body: discardBody(ride),
		action: 'Discard it',
	});
}
