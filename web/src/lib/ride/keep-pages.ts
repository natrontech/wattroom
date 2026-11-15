import { preloadCode } from '$app/navigation';
import type { RouteId } from '$app/types';

/**
 * Every page's code, fetched when a ride starts (#4600). A deploy replaces the
 * code a window loaded with, and the first link to a page whose code this
 * window never fetched then reloads the whole window to get the new one, and
 * the ride ends with it: the trainer's link and the ride's memory go with the
 * page. Fetched once, every page opens from this window's own code whatever
 * is deployed meanwhile.
 *
 * The glob is read for its keys alone: nothing here imports a page.
 */
const PAGES = Object.keys(
	// Escaped: unescaped, one of Vite's two glob engines reads (app) as a group.
	import.meta.glob('/src/routes/\\(app\\)/**/+page*.svelte'),
).map(
	(file) =>
		// +page@.svelte resets its layouts; the route is the same.
		(file.replace('/src/routes', '').replace(/\/\+page[^/]*\.svelte$/, '') ||
			'/') as RouteId,
);

let fetched = false;

export function keepPages(): void {
	if (fetched) return;
	fetched = true;
	for (const id of PAGES) void preloadCode(id).catch(() => {});
}
