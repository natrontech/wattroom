// Which design surfaces a branch touches: `node web/scripts/design-surfaces.mjs`.
//
// Maps every file changed since origin/main — committed or not — through
// docs/design/surface-map.json and prints `<surface> <- <file>` for each
// match, so the surfaces a change is captured on come from the map rather
// than the author's judgement (docs/design/TARGETS.md). Name files instead to
// map just those: `node web/scripts/design-surfaces.mjs web/src/app.css`.
//
// `--targets <surface…>` prints the canon a reviewer reads for those surfaces
// instead (#3858): TARGETS.md without the sections of every other surface.
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

/**
 * Not surfaces but the switches for their variants (#3858): a row lists
 * `phone` or `tv` when its files lay out the phone or the TV, and the design
 * shots then take every captured surface's phone or TV shots too.
 */
export const VARIANTS = ['phone', 'tv'];

export function mapIds(map = loadMap()) {
	return new Set(
		map.flatMap((row) => row.surfaces).filter((id) => !VARIANTS.includes(id)),
	);
}

/**
 * TARGETS.md for a review of these surfaces: everything but the `####`
 * sections of the surfaces not named. Cut by heading, so it holds whatever
 * the file puts around the sections; `missing` is a named id with none.
 */
export function targetsFor(
	ids,
	markdown = readFileSync(new URL('TARGETS.md', DESIGN), 'utf8'),
) {
	const heads = [...markdown.matchAll(/^(#{1,4}) (.+)$/gm)];
	const found = new Set();
	let text = '';
	let from = 0;
	for (const [i, head] of heads.entries()) {
		if (head[1] !== '####') continue;
		const end = heads[i + 1]?.index ?? markdown.length;
		const own = targetIds(head[0]);
		if ([...own].some((id) => ids.includes(id))) {
			own.forEach((id) => found.add(id));
			continue;
		}
		text += markdown.slice(from, head.index);
		from = end;
	}
	text += markdown.slice(from);
	const missing = ids.filter((id) => !found.has(id) && !VARIANTS.includes(id));
	return { text, missing };
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

if (
	process.argv[1] === fileURLToPath(import.meta.url) &&
	process.argv[2] === '--targets'
) {
	// One argument or many: zsh hands `--targets $ids` over unsplit.
	const ids = process.argv.slice(3).flatMap((arg) => arg.split(/[\s,]+/));
	const { text, missing } = targetsFor(ids.filter(Boolean));
	if (missing.length) {
		console.error(`No TARGETS.md section for: ${missing.join(' ')}`);
		process.exitCode = 1;
	}
	process.stdout.write(text);
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const named = process.argv.slice(2);
	const hits = surfacesFor(named.length ? named : changedFiles());
	if (!hits.size)
		console.log(
			'No design surface: no changed file is in docs/design/surface-map.json.',
		);
	for (const [surface, files] of hits)
		for (const file of new Set(files)) console.log(`${surface} <- ${file}`);
}
