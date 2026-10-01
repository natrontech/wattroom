#!/usr/bin/env node
// three.js is ~660 KB, and only the ride world needs it (#3021, #3078). This
// proves, on the built output, that none of it reaches a rider before the
// world is asked for: not in the eager shell chunks every (app) page loads,
// and not in anything a (site) page loads before a click. The source-scan
// guard (lib/world/lazy-three.test.ts) keeps the imports right; this proves
// the bundler kept them apart. Run after `pnpm run build`.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));
const client = `${web}.svelte-kit/output/client/`;
const pages = `${web}build/`;
// three's own log prefix: in the chunk that holds it, and in no other.
const MARK = 'THREE.WebGLRenderer';

const manifest = JSON.parse(
	readFileSync(`${client}.vite/manifest.json`, 'utf8'),
);
const js = Object.entries(manifest).filter(([, c]) => c.file.endsWith('.js'));
const holdsThree = (c) => readFileSync(client + c.file, 'utf8').includes(MARK);

const problems = [];
const fail = (why) => problems.push(why);

// Each half proves nothing unless it can see what it is looking for.
const threeChunks = js.filter(([, c]) => holdsThree(c)).map(([, c]) => c.file);
if (threeChunks.length === 0)
	fail(
		`no chunk carries "${MARK}": three moved its log prefix, so find a new marker`,
	);

/** Everything `keys` loads by static import. */
function closure(keys) {
	const seen = new Set();
	const walk = (k) => {
		if (seen.has(k) || !manifest[k]) return;
		seen.add(k);
		for (const i of manifest[k].imports ?? []) walk(i);
	};
	keys.forEach(walk);
	return seen;
}

const eager = js.filter(
	([, c]) => c.name === 'eager-vendor' || c.name === 'eager-app',
);
if (eager.length !== 2)
	fail(
		`expected the eager-vendor and eager-app chunks, found ${eager.length} (vite.config.ts, eagerShell)`,
	);
for (const k of closure(eager.map(([k]) => k)))
	if (holdsThree(manifest[k]))
		fail(`the eager shell loads three.js, through ${manifest[k].file}`);

const entries = js
	.filter(([k, c]) => c.isEntry && !k.includes('/nodes/'))
	.map(([k]) => k);
const site = readdirSync(pages, { recursive: true })
	.map(String)
	.filter((f) => f.endsWith('.html') && f !== 'spa.html');
if (site.length === 0) fail('no prerendered (site) page in build/');
for (const page of site) {
	const ids = readFileSync(pages + page, 'utf8').match(
		/node_ids:\s*\[([\d,\s]+)\]/,
	);
	if (!ids) {
		fail(
			`${page}: no node_ids in its start script, so its chunks cannot be found`,
		);
		continue;
	}
	const nodes = ids[1]
		.split(',')
		.map((n) => `.svelte-kit/generated/client-optimized/nodes/${n.trim()}.js`);
	for (const k of closure([...entries, ...nodes]))
		if (holdsThree(manifest[k]))
			fail(
				`${page} loads three.js before a click, through ${manifest[k].file}`,
			);
}

if (problems.length) {
	console.error(
		`bundle check: three.js escaped the world's lazy chunk\n  ${problems.join('\n  ')}`,
	);
	process.exit(1);
}
console.log(
	`bundle check: three.js only in ${threeChunks.join(', ')}; the eager shell and ${site.length} (site) pages load none of it`,
);
