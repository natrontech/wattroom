import Activity from '@lucide/svelte/icons/activity';
import CalendarClock from '@lucide/svelte/icons/calendar-clock';
import ChartColumn from '@lucide/svelte/icons/chart-column';
import History from '@lucide/svelte/icons/history';
import House from '@lucide/svelte/icons/house';
import Music from '@lucide/svelte/icons/music';
import MessageSquare from '@lucide/svelte/icons/message-square';
import MessagesSquare from '@lucide/svelte/icons/messages-square';
import Settings from '@lucide/svelte/icons/settings';
import Users from '@lucide/svelte/icons/users';
import type { Icon } from '$lib/icons';

/**
 * The app's destinations, and the places inside a room. Both live in the one
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
 * (ADR-0015, amended — it reaches the rooms they may enter) while every
 * jukebox is room-scoped, so a rider uploading to it or searching it is not
 * standing in a room — and a destination reachable only from inside one is
 * not reachable when you want it. It is not the "second half" of any page
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
		// `/rooms` was retired INTO Home's "your rooms" section — the open/join
		// card, reached as `/home#rooms` — and the directory is that section's
		// other half, the "No code? Find a room" line inside it (#1118). Neither
		// is a destination of its own, and ADR-0020 rule 1 wants the row above
		// them lit all the same: the column went dark on `/rooms/directory` and
		// on the `/rooms` stub still receiving live navigation (#1863).
		covers: ['/rooms'],
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

/** The room you are standing in opens into these. */
export const roomPlaces = [
	{
		path: '',
		label: 'Lounge',
		icon: MessagesSquare,
		hint: 'talk, tiles, the stage',
	},
	{
		path: '/chat',
		label: 'Chat',
		icon: MessageSquare,
		hint: 'the room talking, full width',
	},
	{
		path: '/training',
		label: 'Training',
		icon: Activity,
		hint: 'the session and your numbers',
	},
	{
		path: '/sessions',
		label: 'Sessions',
		icon: CalendarClock,
		hint: "what's planned here",
	},
	{ path: '/members', label: 'Members', icon: Users, hint: 'roles and medals' },
	{
		path: '/settings',
		label: 'Settings',
		icon: Settings,
		hint: 'name, sounds, reactions',
	},
];

/**
 * The places a viewport is offered. Settings is the one place a phone is not:
 * it is a set-up-once, owner-only form — the 95% rule (`ux.md`) says nobody
 * renames a room from a bike, and a drawer that lists everything lists
 * nothing. It stays a URL and still renders, so a bookmark works and the page
 * says it is laid out for a wider screen; it simply is not offered here.
 */
export function placesFor(narrow: boolean) {
	return narrow ? roomPlaces.filter((p) => p.path !== '/settings') : roomPlaces;
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
 * exactly one thing is current either way. A room's chat is not under this
 * heading — the room's own row above carries `/messages/r/[slug]`.
 */
export function dmsCurrent(pathname: string, threadOnScreen: boolean): boolean {
	if (pathname === '/messages') return true;
	return pathname.startsWith('/messages/dm/') && !threadOnScreen;
}

/**
 * Which place inside `slug` a path is on. Longest match wins, so `/training`
 * does not resolve to the lounge's empty path.
 */
export function activePlace(pathname: string, slug: string): string {
	const rest = pathname.slice(`/r/${slug}`.length);
	const hit = roomPlaces
		.filter((p) => p.path && rest.startsWith(p.path))
		.sort((a, b) => b.path.length - a.path.length)[0];
	return hit?.path ?? '';
}
