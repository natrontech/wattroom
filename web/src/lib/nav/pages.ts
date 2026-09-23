import CalendarClock from '@lucide/svelte/icons/calendar-clock';
import ChartColumn from '@lucide/svelte/icons/chart-column';
import History from '@lucide/svelte/icons/history';
import House from '@lucide/svelte/icons/house';
import Music from '@lucide/svelte/icons/music';
import Pin from '@lucide/svelte/icons/pin';
import Settings from '@lucide/svelte/icons/settings';
import Users from '@lucide/svelte/icons/users';
import type { Icon } from '$lib/icons';

/**
 * The app's destinations, and a crew's own pages. Both live in the one
 * sidebar (ADR-0020) — there is no second navigation to keep in sync.
 *
 * Four, not nine. `/rooms` was a list the sidebar already is, `/sessions` the
 * second half of "what is happening" (Home), `/progression` the chart half of
 * a ride log split down the middle, `/ramp` a workout you start rather than a
 * page you visit, and `/settings/equipment` is set up once. A sidebar that lists everything
 * lists nothing.
 *
 * Friends earns a row because ADR-0020 made it a place and nothing drew it as
 * one (#1017): it was a 10 px word at the right-hand end of the messages
 * eyebrow, wearing `normal-case` to fight that container's uppercase back
 * off — which reads as a label on the section beside it, not as a way to go
 * somewhere.
 *
 * Music earns one on the same test (#268): the shelf is the rider's own
 * (ADR-0015, amended — it reaches the voice channels they may enter) while
 * every jukebox is a voice channel's, so a rider uploading to it or searching
 * it is not standing in one — and a destination reachable only from inside one
 * is not reachable when you want it. It is not the "second half" of any page
 * here, which is what the retirements above all had in common.
 */
export const pages: {
	href: string;
	label: string;
	icon: Icon;
	/** Pages this row is the parent of (ADR-0020, rule 1): lit while you are there. */
	covers?: string[];
}[] = [
	{
		href: '/home',
		label: 'Home',
		icon: House,
		// `/rooms` was retired twice — by ADR-0020 into Home, then with the rooms
		// themselves (#2458) — and its stub sends a rider to the crew directory,
		// which is Home's other half: the "No code? Find a crew" line in the
		// open/join card (#1118, #2456). Neither is a destination of its own, and
		// ADR-0020 rule 1 wants the row above them lit all the same: the column
		// went dark on the directory and on the `/rooms` stub still receiving live
		// navigation (#1863).
		// Your rider page is Home's level tile opened (#467), and the name
		// card that used to light for it goes to You now (#2581).
		covers: ['/rooms', '/crews', '/u/me'],
	},
	{
		href: '/workouts',
		label: 'Workouts',
		icon: ChartColumn,
		// A ride and a ramp test are started from Workouts, so Workouts stays
		// lit under them — the column used to go dark (audit 2026-09-09).
		covers: ['/ride', '/ramp'],
	},
	{ href: '/history', label: 'Rides', icon: History },
	{ href: '/music', label: 'Music', icon: Music },
	{ href: '/friends', label: 'Friends', icon: Users },
];

/**
 * A crew's own pages (ADR-0058, #2447, #2569): what the sidebar lists under a
 * chosen crew, above its channels, in the ADR's order. Settings is the
 * admins', and not a phone's (the 95% rule, as a room's was).
 */
export function crewPlaces(
	crewId: string,
	admin: boolean,
	narrow: boolean,
): { href: string; label: string; icon: Icon; exact?: boolean }[] {
	const base = `/crew/${crewId}`;
	return [
		{ href: base, label: 'Home', icon: House, exact: true },
		{ href: `${base}/schedule`, label: 'Schedule', icon: CalendarClock },
		{ href: `${base}/workouts`, label: 'Workouts', icon: ChartColumn },
		{ href: `${base}/board`, label: 'Board', icon: Pin },
		{ href: `${base}/members`, label: 'Members', icon: Users },
		...(admin && !narrow
			? [{ href: `${base}/settings`, label: 'Settings', icon: Settings }]
			: []),
	];
}

/**
 * Which crew the column is in (ADR-0020 rule 1): inside a crew's pages, that
 * crew; on one of your own pages, none — You, whose list is where their row
 * is (#2581 took YOU out of a crew's column again); anywhere else the crew
 * you chose last.
 */
export function columnCrew<T extends { id: string }>(
	pathname: string,
	crews: T[],
	chosen: string | null,
): T | null {
	const inCrew = crewOfPath(pathname);
	if (inCrew) return crews.find((c) => c.id === inCrew) ?? null;
	if (activeHref(pathname)) return null;
	return crews.find((c) => c.id === chosen) ?? null;
}

/**
 * Which crew a path is inside, if any — the sidebar is in that crew while
 * you stand in it, whatever was chosen last (ADR-0020 rule 1).
 */
export function crewOfPath(pathname: string): string | undefined {
	return /^\/crew\/([^/]+)/.exec(pathname)?.[1];
}

/** Which destination a path lights up. */
export function activeHref(pathname: string): string | undefined {
	return pages.find(
		(p) =>
			pathname.startsWith(p.href) ||
			p.covers?.some((c) => pathname.startsWith(c)),
	)?.href;
}

/**
 * Whether the direct-messages heading is what a path lights.
 *
 * ADR-0020 rule 1 wants one lit row per page, and this section's rows cannot
 * always supply it: `/messages` is the section's own index — on a desk it is
 * the page that says the list is in the column — so no thread row belongs to
 * it at all, and a thread's row can be off screen while you read it (the fold
 * is shut, or the list has not landed, or the conversation is new enough to
 * have no entry yet). The heading answers whenever the row cannot, the way
 * the crew header answers for `/crew/[id]` (#1335) and the way this heading
 * already carries the unread dot for messages behind it.
 *
 * `threadOnScreen` is therefore the whole test, not the fold: it is the one
 * question that has the same answer in every reason the row is missing.
 * A row that IS on screen lights itself and the heading stays dark, so
 * exactly one thing is current either way.
 */
export function dmsCurrent(pathname: string, threadOnScreen: boolean): boolean {
	if (pathname === '/messages') return true;
	return pathname.startsWith('/messages/dm/') && !threadOnScreen;
}
