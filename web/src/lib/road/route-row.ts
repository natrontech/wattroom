import { formatKm } from '$lib/format';
import type { Climb, ClimbClass } from './climbs';
import type { StoredRoute } from './stored';

/**
 * What one route row says (#3683), the same in the Workouts shelf and every
 * road picker: the classes of its climbs, its numbers, and how its owner has
 * ridden it.
 */

const HARDEST_FIRST: ClimbClass[] = ['HC', 'I', 'II', 'III', 'IV'];

/** Each class once, hardest first; the first is the one filled neon. */
export function classChips(climbs: Climb[]): ClimbClass[] {
	const seen = new Set(climbs.flatMap((c) => (c.cls ? [c.cls] : [])));
	return HARDEST_FIRST.filter((cls) => seen.has(cls));
}

/** “7.1 km · 571 m · 1 climb”: length, gain, and its classed climbs. */
export function statLine(
	route: Pick<StoredRoute, 'lengthM' | 'gainM' | 'climbs'>,
): string {
	const climbs = route.climbs.filter((c) => c.cls).length;
	return [
		`${formatKm(route.lengthM)} km`,
		`${route.gainM} m`,
		...(climbs ? [`${climbs} ${climbs === 1 ? 'climb' : 'climbs'}`] : []),
	].join(' · ');
}

/**
 * Where the owner stands with the road: where they left off when there is
 * somewhere to carry on, else how often and when they last rode it.
 */
export function riddenLine(
	route: Pick<StoredRoute, 'rides' | 'lastRiddenAt' | 'carryOnM'>,
): string {
	if (route.carryOnM !== undefined)
		return `Left off at km ${formatKm(route.carryOnM)}`;
	if (!route.rides || !route.lastRiddenAt) return 'Not ridden yet';
	const last = new Date(route.lastRiddenAt).toLocaleDateString(undefined, {
		day: 'numeric',
		month: 'short',
	});
	return `Ridden ${route.rides}× · last ${last}`;
}

/**
 * The route page's back link (TARGETS Flows rule 4): the page a row's name was
 * opened from, else Workouts. Only a path on this site: `?back=` is a URL
 * anyone can write, and an open redirect is not a back link.
 */
export function backLink(back: string | null): { href: string; label: string } {
	if (!back || !/^\/(?![/\\])/.test(back) || back.includes('\\'))
		return { href: '/workouts', label: 'Workouts' };
	return { href: back, label: back === '/ride' ? 'Ride' : 'Back' };
}
