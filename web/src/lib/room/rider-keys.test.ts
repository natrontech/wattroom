import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
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
		// Every production surface under src, not this directory alone
		// (#1593): the download page keyed a list by name too.
		const root = join(import.meta.dirname, '..', '..');
		const offenders: string[] = [];
		for (const file of readdirSync(root, { recursive: true })) {
			const name = String(file);
			if (!name.endsWith('.svelte')) continue;
			// The dev galleries key static mocks by name — medals, rooms, glow
			// samples — and two of them never share one; the rule is about
			// riders in a real room.
			if (name.startsWith('routes/dev/')) continue;
			const source = readFileSync(join(root, name), 'utf8');
			for (const match of source.matchAll(
				/\{#each [^}]* as (\w+) \((\w+)\.name\)\}/g,
			)) {
				offenders.push(
					`${relative(root, join(root, name))}: (${match[2]}.name)`,
				);
			}
		}
		expect(offenders).toEqual([]);
	});
});
