// A plain unit test, not a Playwright spec (vite.config.ts splits them by
// suffix): it reads the route tree and needs no browser, no server and no
// database. That placement is the point — `e2e` is advisory on main's ruleset,
// so a drift caught only there blocks nothing, while `web` is required (#2386).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { discoverRoutes, unaccountedRoutes } from './routes.js';

const trees: string[] = [];

/** A throwaway route tree: `+page.svelte` at each of the given paths. */
function treeOf(...routes: string[]): string {
	const root = mkdtempSync(join(tmpdir(), 'wattroom-routes-'));
	trees.push(root);
	for (const route of routes) {
		const dir = join(root, route);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, '+page.svelte'), '');
	}
	return root;
}

afterEach(() => {
	for (const root of trees.splice(0))
		rmSync(root, { recursive: true, force: true });
});

it('accounts for every route under web/src/routes', () => {
	// The whole point of the file. `unmentioned` is a route nobody measured and
	// nobody excused — add it to MEASURED, or to NOT_MEASURED with the reason.
	// `stale` is an entry that no longer matches anything on disk.
	expect(unaccountedRoutes()).toEqual({ unmentioned: [], stale: [] });
});

it('reports a route the lists do not mention', () => {
	// Seen to fail: this is the case the real tree must never reach.
	expect(
		unaccountedRoutes(treeOf('home', 'brand-new-surface')).unmentioned,
	).toEqual(['/brand-new-surface']);
});

it('reports an entry that matches nothing on disk', () => {
	const stale = unaccountedRoutes(treeOf('home')).stale;
	expect(stale).toContain('/hud');
	expect(stale).toContain('/dev/*');
});

it('reads a route group out of the URL and a +page.ts as a route', () => {
	const root = treeOf('(legal)/terms', 'settings/profile');
	mkdirSync(join(root, 'settings'), { recursive: true });
	writeFileSync(join(root, 'settings', '+page.ts'), '');

	expect(discoverRoutes(root)).toEqual([
		'/settings',
		'/settings/profile',
		'/terms',
	]);
});
