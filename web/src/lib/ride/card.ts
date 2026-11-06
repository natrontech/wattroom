import { apiBlob } from '$lib/api';
import type { ThemeFamily } from '$lib/palette';

/**
 * The ride as a picture (#2112). Strava's API uploads the activity and never
 * a photo for it, so a WattRoom ride gets onto Strava as an image the way
 * every other photo does: the rider saves this and adds it themselves.
 *
 * Drawn by the server (internal/og), so the two surfaces that offer it — the
 * ride's page and the screen a rider is standing at when they want it — ask
 * for a URL rather than each growing a renderer. Drawn in the theme asked
 * for (#4098): the family always resolved here, since the account's `auto`
 * means nothing to a server.
 */
export function fetchRideCard(
	id: string,
	theme: { identity: string; family: ThemeFamily },
) {
	const query = new URLSearchParams(theme);
	return apiBlob(`/api/rides/${encodeURIComponent(id)}/card.png?${query}`);
}

/**
 * Whether the ride's picture is a poster: a ride on a road drawn as the road
 * it rode (#3142). A workout on a road is not one — in a workout the workout
 * comes first, its blocks, watts and heart rate with the road under them
 * (#4430) — so only a ride on a road that was no workout gets the poster.
 * The server draws by the same word (rides/card.go).
 */
export const isPoster = (ride: { distanceM?: number; rideMode?: string }) =>
	ride.distanceM !== undefined && ride.rideMode !== 'workout';

/**
 * What the button that downloads it says: the poster, and the button says
 * so, or the ride's card, and the button says what it does (#3687).
 */
export const cardLabel = (ride: { distanceM?: number; rideMode?: string }) =>
	isPoster(ride) ? 'Download the poster' : 'Download the ride card';
