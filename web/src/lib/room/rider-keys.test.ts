import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Display names are not unique (users.display_name carries no constraint),
 * and a keyed each over a rider's name throws `each_key_duplicate` the moment
 * two Daves share a room — in production builds too — tearing the surface
 * down mid-ride (audit 2026-09-09). TV mode and the execution meter were
 * keyed that way. Read from source, like stacking.test.ts: the key
 * expression is the thing, and no render exercises two riders with one name.
 */
describe('rider each-blocks', () => {
	it('are keyed by id, never by display name', () => {
		const dir = join(import.meta.dirname);
		const offenders: string[] = [];
		for (const file of readdirSync(dir).filter((f) => f.endsWith('.svelte'))) {
			const source = readFileSync(join(dir, file), 'utf8');
			for (const match of source.matchAll(
				/\{#each [^}]* as (\w+) \((\w+)\.name\)\}/g,
			)) {
				offenders.push(`${file}: (${match[2]}.name)`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
