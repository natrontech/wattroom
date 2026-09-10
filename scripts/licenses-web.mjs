// Every npm package whose code or assets can reach the built SPA, with its
// licence text. Written to web/static/legal/web.json, which the /legal/licenses
// page fetches — a static asset rather than an import, so a page nobody visits
// costs the bundle nothing.
//
// Deliberately NOT `--prod`. A bundler pulls assets out of devDependencies too:
// @fontsource/barlow and @fontsource/chakra-petch are devDependencies whose
// woff2 files ship in every build, and they are the only OFL-1.1 in the tree —
// the exact licence #1670 was filed about. Over-inclusion costs a few lines on
// a page; under-inclusion is the compliance gap.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LICENCE_FILE = /^(LICEN[CS]E|COPYING|LICENSE-MIT|OFL)(\.(txt|md))?$/i;

function licenceText(dir) {
	try {
		const name = readdirSync(dir).find((f) => LICENCE_FILE.test(f));
		return name ? readFileSync(join(dir, name), 'utf8').trim() : '';
	} catch {
		return '';
	}
}

const raw = JSON.parse(
	execFileSync('pnpm', ['licenses', 'list', '--json'], {
		cwd: new URL('../web/', import.meta.url).pathname,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	}),
);

// A package that declares `os` or `cpu` is a platform-native binary — esbuild's
// and rolldown's compiled bindings, fsevents. They are build machinery that
// cannot appear in a browser bundle, and including them would make this file
// differ on every contributor's machine: a Mac produces
// @rolldown/binding-darwin-arm64 where CI produces -linux-x64-gnu, and the
// drift check could never pass on both.
function isPlatformBinary(dir) {
	try {
		const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
		return Boolean(meta.os || meta.cpu);
	} catch {
		return false;
	}
}

const packages = Object.values(raw)
	.flat()
	.filter((p) => !isPlatformBinary((p.paths ?? [])[0] ?? ''))
	.map((p) => ({
		name: p.name,
		version: (p.versions ?? []).join(', '),
		license: p.license,
		homepage: p.homepage ?? '',
		text: licenceText((p.paths ?? [])[0] ?? ''),
		textMissing: false,
	}))
	.sort((a, b) => a.name.localeCompare(b.name));

// Some packages ship no LICENCE file, only the `license` field in their
// package.json. Naming the package and its declared licence is what we can
// honestly say about those, so the page says exactly that rather than
// implying we reproduced a text we never had.
const missing = packages.filter((p) => !p.text);
for (const p of missing) p.textMissing = true;

writeFileSync(
	new URL('../web/static/legal/web.json', import.meta.url),
	JSON.stringify({ packages }, null, '\t') + '\n',
);
console.log(`web: ${packages.length} packages`);
