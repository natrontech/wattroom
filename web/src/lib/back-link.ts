/**
 * Back links (TARGETS Flows rule 4): a link that opens a page carries the page
 * it was opened from as `?back=`, and the page it opens goes back there. Only
 * ever a path on this site: `?back=` is a URL anyone can write, and an open
 * redirect is not a back link.
 */

export interface BackLink {
	href: string;
	label: string;
}

/** A `?back=` value if it is a path on this site, else null. */
export function localPath(back: string | null): string | null {
	return back && /^\/(?![/\\])/.test(back) && !back.includes('\\')
		? back
		: null;
}

/** `path`, carrying the page it is opened from as its way back. */
export const withBack = (path: string, back?: string | null): string =>
	back ? `${path}?back=${encodeURIComponent(back)}` : path;

/** The route page's: the picker a row's name was opened from, else Workouts. */
export function routeBackLink(back: string | null): BackLink {
	const href = localPath(back);
	if (!href) return { href: '/workouts', label: 'Workouts' };
	return { href, label: href === '/ride' ? 'Ride' : 'Back' };
}

/**
 * The ride page's (#3874): the page that opened it, named for the road when
 * it is that road's route page, else Rides.
 */
export function rideBackLink(
	back: string | null,
	road?: { routeId: string; name: string },
): BackLink {
	const href = localPath(back);
	if (!href) return { href: '/history', label: 'Rides' };
	const onRoad =
		road && href.split('?')[0] === `/workouts/routes/${road.routeId}`;
	return { href, label: onRoad ? road.name : 'Back' };
}
