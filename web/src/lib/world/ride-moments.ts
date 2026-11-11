import type { Route } from '$lib/road/route';
import {
	momentToDraw,
	worldPicture,
	type PictureMoment,
} from './picture.svelte';

/** The moments a ride's pictures are drawn from: the ones logged, the photos taken, and how many of those a close already drew. */
export type RideMoments = {
	ridden: PictureMoment[];
	chosen: PictureMoment[];
	drawn: number;
};

let kept: { ride: object; moments: RideMoments } | null = null;

/**
 * The picture's moments for the world opening on `ride` (ADR-0093 point 10).
 * A world reopened mid-ride carries on from the ride's moments and its
 * pictures; a new ride starts with neither. A world with no ride to name is
 * a ride of its own.
 */
export function momentsFor(ride: object | undefined): RideMoments {
	if (ride && kept?.ride === ride) return kept.moments;
	worldPicture.clear();
	const moments: RideMoments = { ridden: [], chosen: [], drawn: 0 };
	kept = ride ? { ride, moments } : null;
	return moments;
}

/**
 * What a closing world draws, and marks drawn: the photos taken since the
 * last close, each by its number on the ride, so a world opened and closed
 * again mid-ride never draws one twice; or, on a ride the rider took none
 * of, the ride's best moment, drawn again at every close as it may have
 * moved.
 */
export function dueToDraw(
	moments: RideMoments,
	route: Route | null,
): { n: number | null; at: PictureMoment }[] {
	if (moments.chosen.length === 0) {
		const at = momentToDraw(null, route, moments.ridden);
		return at ? [{ n: null, at }] : [];
	}
	const from = moments.drawn;
	moments.drawn = moments.chosen.length;
	return moments.chosen.slice(from).map((at, i) => ({ n: from + i + 1, at }));
}
