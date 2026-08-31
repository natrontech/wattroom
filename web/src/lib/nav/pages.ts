import {
	ChartColumn,
	Gauge,
	History,
	House,
	TrendingUp,
	UserRound,
	Users,
	Zap,
} from '@lucide/svelte';

/**
 * The app's page navigation: the top bar shows all of it, the phone tab bar
 * the `primary` five. Glossary vocabulary only — no per-screen synonyms.
 */
export const pages = [
	{ href: '/home', label: 'Home', icon: House, primary: true },
	{ href: '/rooms', label: 'Rooms', icon: Users, primary: true },
	{ href: '/workouts', label: 'Workouts', icon: ChartColumn, primary: true },
	{ href: '/ramp', label: 'Ramp test', icon: Gauge, primary: false },
	{ href: '/pair', label: 'Sensors', icon: Zap, primary: false },
	{ href: '/history', label: 'Rides', icon: History, primary: true },
	{
		href: '/progression',
		label: 'Progression',
		icon: TrendingUp,
		primary: false,
	},
	{ href: '/profile', label: 'Profile', icon: UserRound, primary: true },
];

/**
 * Which entry a path lights up. A room page (/r/…) belongs to Rooms, and so
 * does /sessions — planning is something you do to a room, not a ninth
 * destination competing with it in the bar.
 */
const ROOMS_PATHS = ['/rooms', '/r/', '/sessions'];

export function activeHref(pathname: string): string | undefined {
	return pages.find((p) =>
		p.href === '/rooms'
			? ROOMS_PATHS.some((prefix) => pathname.startsWith(prefix))
			: pathname.startsWith(p.href),
	)?.href;
}
