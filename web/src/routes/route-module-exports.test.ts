import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * SvelteKit validates a route module's exports at RUNTIME. A helper exported
 * beside `load` — `export const rideCursorOf = …` in `+page.ts`, which is how
 * this test came to exist (#2064) — throws "Invalid export" and the route
 * renders the 500 page. Nothing else here catches it: `svelte-check` and
 * `prettier` see valid TypeScript, and a unit test that imports `load`
 * directly never goes near SvelteKit's validator.
 *
 * Types are erased before the validator runs, so `export type` and
 * `export interface` are free. Values are not: put them in `$lib`.
 */
const allowed = new Set([
	'load',
	'prerender',
	'csr',
	'ssr',
	'trailingSlash',
	'config',
	'entries',
	'actions',
]);

function routeModules(dir: string, found: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			routeModules(path, found);
		} else if (/^\+(page|layout)(\.server)?\.ts$/.test(entry)) {
			found.push(path);
		}
	}
	return found;
}

// `export const x`, `export function x`, `export let x` — the value exports.
// `export type`/`export interface`/`export { type … }` are erased and fine.
const valueExport =
	/^\s*export\s+(?:async\s+)?(?:const|let|var|function|class)\s+(\w+)/gm;

describe('route modules export only what SvelteKit allows', () => {
	const modules = routeModules(join(import.meta.dirname));
	it('finds the route modules at all', () => {
		expect(modules.length).toBeGreaterThan(5);
	});
	for (const path of modules) {
		it(path.slice(path.indexOf('/routes/')), () => {
			const source = readFileSync(path, 'utf8');
			const offenders = [...source.matchAll(valueExport)]
				.map((m) => m[1])
				.filter((name) => !allowed.has(name) && !name.startsWith('_'));
			expect(offenders).toEqual([]);
		});
	}
});
