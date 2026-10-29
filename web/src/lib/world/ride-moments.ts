import { worldPicture, type PictureMoment } from './picture.svelte';

/** The moments a ride's picture is drawn from: the ones logged, and the one taken. */
export type RideMoments = {
	ridden: PictureMoment[];
	chosen: PictureMoment | null;
};

let kept: { ride: object; moments: RideMoments } | null = null;

/**
 * The picture's moments for the world opening on `ride` (ADR-0093 point 10).
 * A world reopened mid-ride carries on from the ride's moments and its
 * picture; a new ride starts with neither. A world with no ride to name is
 * a ride of its own.
 */
export function momentsFor(ride: object | undefined): RideMoments {
	if (ride && kept?.ride === ride) return kept.moments;
	worldPicture.clear();
	const moments: RideMoments = { ridden: [], chosen: null };
	kept = ride ? { ride, moments } : null;
	return moments;
}
