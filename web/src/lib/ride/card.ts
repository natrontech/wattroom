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
 * What the button that downloads it says. A ride on a road is drawn as the
 * road it rode — a poster (#3142) — and the button says so; every other ride
 * gets its card, and the button says what it does (#3687).
 */
export const cardLabel = (ride: { distanceM?: number }) =>
	ride.distanceM !== undefined
		? 'Download the poster'
		: 'Download the ride card';
