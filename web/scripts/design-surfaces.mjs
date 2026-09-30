// Which design surfaces a branch touches: `node web/scripts/design-surfaces.mjs`.
//
// Maps every file changed since origin/main — committed or not — through
// docs/design/surface-map.json and prints `<surface> <- <file>` for each
// match, so the surfaces a change is captured on come from the map rather
// than the author's judgement (docs/design/TARGETS.md). Name files instead to
// map just those: `node web/scripts/design-surfaces.mjs web/src/app.css`.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { matchesGlob } from 'node:path';
import { fileURLToPath } from 'node:url';

const DESIGN = new URL('../../docs/design/', import.meta.url);

/** @returns {{ files: string[], surfaces: string[] }[]} */
export function loadMap() {
	return JSON.parse(readFileSync(new URL('surface-map.json', DESIGN), 'utf8'));
}

/** Every surface id TARGETS.md gives a section: `#### hud, hud-shell`. */
export function targetIds(
	markdown = readFileSync(new URL('TARGETS.md', DESIGN), 'utf8'),
) {
	const ids = new Set();
	for (const [, heading] of markdown.matchAll(/^#### (.+)$/gm))
		for (const id of heading.replace(/\s*\(.*\)$/, '').split(','))
			ids.add(id.trim());
	return ids;
}

export function mapIds(map = loadMap()) {
	return new Set(map.flatMap((row) => row.surfaces));
}

/** surface → the changed files that select it, surfaces sorted. */
export function surfacesFor(files, map = loadMap()) {
	const hits = new Map();
	for (const file of files)
		for (const row of map)
			if (row.files.some((glob) => matchesGlob(file, glob)))
				for (const surface of row.surfaces)
					hits.set(surface, [...(hits.get(surface) ?? []), file]);
	return new Map([...hits].sort(([a], [b]) => a.localeCompare(b)));
}

function changedFiles() {
	const root = fileURLToPath(new URL('../../', import.meta.url));
	const diff = (...args) =>
		execFileSync('git', ['diff', '--name-only', ...args], {
			cwd: root,
			encoding: 'utf8',
		})
			.split('\n')
			.filter(Boolean);
	return [...new Set([...diff('origin/main...HEAD'), ...diff('HEAD')])];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const named = process.argv.slice(2);
	const hits = surfacesFor(named.length ? named : changedFiles());
	if (!hits.size)
		console.log(
			'No design surface: no changed file is in docs/design/surface-map.json.',
		);
	for (const [surface, files] of hits)
		for (const file of new Set(files)) console.log(`${surface} <- ${file}`);
}
