// A plain unit test beside the script it checks: vitest's default glob picks
// it up in the required `web` job, and it needs no browser or server.
import { expect, it } from 'vitest';
import { loadMap, mapIds, surfacesFor, targetIds } from './design-surfaces.mjs';

it('keeps docs/design/surface-map.json and TARGETS.md in step', () => {
	// A surface TARGETS.md describes that no file selects is never captured;
	// a map id TARGETS.md has no section for has no must-match list to check.
	const targets = targetIds();
	const mapped = mapIds();
	expect([...targets].filter((id) => !mapped.has(id))).toEqual([]);
	expect([...mapped].filter((id) => !targets.has(id))).toEqual([]);
});

it('reads the surface ids off every TARGETS.md section heading', () => {
	expect([
		...targetIds(
			'#### hud, hud-shell\n#### ride-preride (a desk surface)\n### C. Roads',
		),
	]).toEqual(['hud', 'hud-shell', 'ride-preride']);
});

it('maps a changed file to the surfaces it draws', () => {
	const hits = surfacesFor([
		'web/src/lib/session/docks.ts',
		'web/src/routes/(app)/crew/[id]/s/[session]/watch/+page.svelte',
		'server/internal/hub/hub.go',
	]);
	expect(hits.get('ride-road-world')).toEqual(['web/src/lib/session/docks.ts']);
	// SvelteKit's brackets and groups are path segments here, never glob syntax.
	expect(hits.get('ride-watch')).toContain(
		'web/src/routes/(app)/crew/[id]/s/[session]/watch/+page.svelte',
	);
	expect([...hits.values()].flat()).not.toContain('server/internal/hub/hub.go');
});

it('lists every surface of a row, sorted, once per file', () => {
	const hits = surfacesFor(['web/src/lib/brand/Logo.svelte'], loadMap());
	expect([...hits]).toEqual([['landing', ['web/src/lib/brand/Logo.svelte']]]);
});
