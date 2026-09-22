import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The routes phone-width.spec.ts measures, and the reason for every route it
 * does not (#2386).
 *
 * The lists below used to be one array typed by hand into the spec and checked
 * against `web/src/routes/` by eye. Nothing failed when a route was added, so a
 * new surface was simply never measured at 375×812 — while `.claude/rules/ux.md`
 * cites that spec as what enforces the phone-width standard "for every route".
 *
 * They are still written by hand, because which routes are worth measuring and
 * why is a decision. What is no longer by hand is the reconciliation:
 * `unaccountedRoutes()` walks the route tree and reports anything these lists do
 * not mention, in either direction, and `routes.test.ts` fails on it. Adding a
 * route is then a choice someone records — measured here, or excluded with the
 * reason — instead of one nobody notices.
 */

/** Every route a rider reaches without a room, by a fixed path. */
export const MEASURED: readonly string[] = [
	'/home',
	'/workouts',
	'/workouts/edit',
	'/workouts/import',
	'/music',
	'/history',
	'/ride',
	'/friends',
	'/messages',
	'/ramp',
	'/settings/profile',
	'/settings/equipment',
	'/settings/voice',
	'/settings/appearance',
	'/settings/notifications',
	'/settings/data',
	'/whats-new',
	'/crews/directory',
	'/download',
	'/legal',
	'/legal/licenses',
	'/terms',
	'/privacy',
];

/**
 * Reached signed out, so outside the shell that gives everything else
 * `page-body`. Measured by their own test, on the document's own width.
 */
export const MEASURED_SIGNED_OUT: readonly string[] = [
	'/',
	'/login',
	'/login/recover',
];

/**
 * Parameterised, so the spec resolves each id at runtime and asserts that it
 * did — a run where one failed to resolve would pass while measuring nothing.
 */
export const MEASURED_BY_ID: readonly string[] = [
	'/u/[id]',
	'/history/[id]',
	'/messages/dm/[peer]',
	'/crew/[id]',
	'/crew/[id]/members',
	'/crew/[id]/settings',
	'/crew/[id]/schedule',
	'/crew/[id]/c/[channel]',
	'/crew/[id]/board',
	'/crew/[id]/workouts',
	'/c/[code]',
];

/**
 * Not measured, and why. A key ending in `/*` covers that subtree; every key
 * has to match something on disk, so a deleted route does not leave its excuse
 * behind for the next reader to trust.
 */
export const NOT_MEASURED: Readonly<Record<string, string>> = {
	'/dev/*':
		'Mock screens for design iteration: dev/+layout.ts 404s them outside a dev build.',
	'/r/[slug]/*':
		'Retired with the rooms (#2458): every old room path redirects to the crew or channel it became.',
	'/messages/r/[slug]':
		'A room’s thread is its text channel’s now (#2458); +page.ts redirects.',
	'/crew/[id]/v/*':
		'A voice channel is the room’s live shell on another address (#2449) — mobile-room.spec.ts’s subject until the room goes (#2460).',
	'/crew/[id]/s/*':
		'A session is the voice channel’s live shell with the ride in front (#2450) — mobile-room.spec.ts’s subject until the room goes (#2460).',
	'/hud':
		'Numbers only, deliberately outside the page frame: hud.spec.ts asserts it has no page-body.',
	'/settings':
		'The settings tree, not a page: +page.ts redirects to /settings/profile.',
	'/progression': 'Retired by ADR-0020; redirects to /history.',
	'/sessions': 'Retired by ADR-0020; redirects to /home#sessions.',
	'/rooms': 'Retired with the rooms (#2458); redirects to /crews/directory.',
	'/dm/[peer]': 'Moved to /messages/dm/[peer] (#468); +page.ts redirects.',
};

const ROUTE_TREE = fileURLToPath(new URL('../src/routes', import.meta.url));

/**
 * Every route SvelteKit serves, as its URL path. A `+page.ts` alone is a route
 * too — that is all `/settings` and `/dm/[peer]` are — so a walk that looked
 * only for `+page.svelte` would miss exactly the redirects this list excuses.
 */
export function discoverRoutes(dir: string = ROUTE_TREE): string[] {
	const found: string[] = [];

	const walk = (absolute: string, segments: string[]): void => {
		let isRoute = false;
		const children: string[] = [];
		for (const entry of readdirSync(absolute, { withFileTypes: true })) {
			if (entry.isDirectory()) children.push(entry.name);
			else if (entry.name === '+page.svelte' || entry.name === '+page.ts')
				isRoute = true;
		}
		if (isRoute) found.push(`/${segments.join('/')}`);
		for (const child of children)
			// A (group) organises files without appearing in the URL.
			walk(
				`${absolute}/${child}`,
				/^\(.+\)$/.test(child) ? segments : [...segments, child],
			);
	};

	walk(dir, []);
	return found.sort();
}

const subtreeOf = (key: string): string | null =>
	key.endsWith('/*') ? key.slice(0, -2) : null;

const covers = (key: string, route: string): boolean => {
	const subtree = subtreeOf(key);
	return subtree === null
		? key === route
		: route === subtree || route.startsWith(`${subtree}/`);
};

/**
 * Drift, both ways: routes on disk that no list mentions, and list entries that
 * match nothing on disk. Empty is the only passing answer.
 */
export function unaccountedRoutes(dir: string = ROUTE_TREE): {
	unmentioned: string[];
	stale: string[];
} {
	const onDisk = discoverRoutes(dir);
	const listed = [...MEASURED, ...MEASURED_SIGNED_OUT, ...MEASURED_BY_ID];
	const excuses = Object.keys(NOT_MEASURED);

	return {
		unmentioned: onDisk.filter(
			(route) =>
				!listed.includes(route) && !excuses.some((key) => covers(key, route)),
		),
		stale: [
			...listed.filter((route) => !onDisk.includes(route)),
			...excuses.filter((key) => !onDisk.some((route) => covers(key, route))),
		].sort(),
	};
}
