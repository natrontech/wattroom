// A plain unit test beside the script it checks: vitest's default glob picks
// it up in the required `web` job, and it needs no browser or server.
import { expect, it } from 'vitest';
import {
	VARIANTS,
	loadMap,
	mapIds,
	surfacesFor,
	targetIds,
	targetsFor,
} from './design-surfaces.mjs';

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

it('maps a file every page shares to the core set, never to every surface', () => {
	// #3858: app.css used to select eight surfaces in both schemes, and the
	// app's own layout twelve.
	const core = [
		'appearance',
		'home',
		'ride-road-world',
		'ride-workout-flat',
		'route',
	];
	for (const shared of [
		'web/src/app.css',
		'web/src/lib/themes.ts',
		'web/src/routes/(app)/+layout.svelte',
	])
		expect([...surfacesFor([shared]).keys()]).toEqual(core);
	expect([...surfacesFor(['web/src/lib/world/backdrop.ts']).keys()]).toEqual([
		'ride-road-world',
		'world-end',
		'world-start',
	]);
});

it('takes the TV and the phone only for the files that lay them out', () => {
	const tvOrPhone = (id) => /(^|-)(tv|phone)(-|$)/.test(id);
	for (const shared of [
		'web/src/app.css',
		'web/src/lib/session/docks.ts',
		'web/src/lib/workout/ride-life.svelte.ts',
		'web/src/routes/(app)/ride/+page.svelte',
		'web/src/routes/(app)/workouts/+page.svelte',
		'web/src/routes/(app)/home/+page.svelte',
		'web/src/lib/world/scene.ts',
	])
		expect([...surfacesFor([shared]).keys()].filter(tvOrPhone)).toEqual([]);
	expect([
		...surfacesFor(['web/src/lib/session/TvMode.svelte']).keys(),
	]).toEqual(['ride-tv']);
	expect([
		...surfacesFor(['web/src/lib/session/TrainingPhone.svelte']).keys(),
	]).toContain('phone');
	expect(
		[...surfacesFor(['web/src/lib/device.svelte.ts']).keys()].every(tvOrPhone),
	).toBe(true);
	expect(VARIANTS).toEqual(['phone', 'tv']);
});

it("hands a reviewer the captured surfaces' sections and the rules, nothing else", () => {
	const targets = [
		'# Design targets',
		'## Global rules',
		'G1. The cave.',
		'## Surfaces',
		'### A. Riding',
		'#### ride-road-world',
		'1. The world fills the frame.',
		'#### hud, hud-shell',
		'1. One block.',
		'### C. Desk',
		'#### workouts, phone-workouts',
		'1. The page fills the column.',
		'',
	].join('\n');
	const { text, missing } = targetsFor(
		['hud-shell', 'workouts', 'phone', 'nowhere'],
		targets,
	);
	expect(text).toContain('G1. The cave.');
	expect(text).toContain('#### hud, hud-shell\n1. One block.\n');
	expect(text).toContain(
		'#### workouts, phone-workouts\n1. The page fills the column.\n',
	);
	expect(text).not.toContain('ride-road-world');
	expect(text).not.toContain('The world fills the frame.');
	expect(missing).toEqual(['nowhere']);
	// The real file: every surface the map names has a section to hand over.
	expect(targetsFor([...mapIds()]).missing).toEqual([]);
});
