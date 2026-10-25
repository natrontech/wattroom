#!/usr/bin/env node
// The world soak (#3851): rides /dev/world for two simulated hours at 16× and
// fails if frame time, the heap, three.js's geometries and textures, the
// ground held, or the page's listeners and timers climb (e2e/world-soak.spec.ts,
// judged by e2e/soak/gate.ts). Builds a dev bundle and serves it through the
// e2e harness, as the design shots do; needs Postgres (make infra).
//
//   node scripts/world-soak.mjs                    two simulated hours
//   node scripts/world-soak.mjs --minutes 15       a short one, for development
//   node scripts/world-soak.mjs --speed 1          wall-clock time: two real hours
//   node scripts/world-soak.mjs --out dir          where report.md and samples.json go
//   node scripts/world-soak.mjs --leak all         each leak below, injected: the gate must go red
//   node scripts/world-soak.mjs --leak listener    just that one
//
// Software GL draws slower than 16× asks: a frame moves the ride at most a
// tenth of a second times the speed, so two simulated hours take 15–30
// minutes of wall time on a four-core runner.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));
const world = 'src/lib/world/';

// Each leak class the gate guards, put into the world on purpose:
// [id, what leaks, file under src/lib/world/, from, to, the metric that must go red].
// prettier-ignore
const LEAKS = [
	['texture', "a tile's sign slots never freed: a new texture page per few tiles", 'boards.ts', "if ('page' in m) m.page.free.push(m.slot);", "if ('page' in m) void m.slot;", 'textures'],
	['listener', 'a listener per ground chunk', 'stage.ts', 'add: (id, [ci, cj], grid) =>', "add: (id, [ci, cj], grid) => void window.addEventListener('resize', () => id) ||", 'listeners'],
	['interval', 'an interval per ground chunk', 'stage.ts', 'add: (id, [ci, cj], grid) =>', 'add: (id, [ci, cj], grid) => void setInterval(() => id, 60_000) ||', 'intervals'],
	['heap', "each ground chunk's grid kept for good", 'stage.ts', 'add: (id, [ci, cj], grid) =>', 'add: (id, [ci, cj], grid) => void ((globalThis as { kept?: unknown[] }).kept ??= []).push(structuredClone(grid)) ||', 'heapMB'],
	['ground', 'ground chunks never let go', 'ground-stream.ts', 'if (toChunk(x, z, ...h.chunk) > reach.far * LEAVE) {', 'if (toChunk(x, z, ...h.chunk) > reach.far * LEAVE * 100) {', 'ground'],
];

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const at = args.indexOf(`--${name}`);
	return at >= 0 ? args[at + 1] : fallback;
};
const leak = flag('leak', null);
// Two hours for a leak too: a shorter ride ends while the ground around the
// eye is still filling in, so a sound world fails it, and a sign's texture
// page leaks too slowly to show (#3851).
const minutes = Number(flag('minutes', 120));
const speed = Number(flag('speed', 16));
const out = resolve(
	flag(
		'out',
		join(web, 'world-soak', new Date().toISOString().replace(/[:.]/g, '-')),
	),
);

/** One soak into `dir`; its verdict, or null when it never judged (it broke before). */
function soak(dir) {
	try {
		execFileSync(
			'pnpm',
			['exec', 'playwright', 'test', '--project=soak', '--reporter=list'],
			{
				cwd: web,
				stdio: 'inherit',
				env: {
					...process.env,
					// The dev hooks — /dev/world, the world's probe and frames, software
					// drawing — in a bundle that loads like the real one (make design-shots).
					NODE_ENV: 'development',
					WORLD_SOAK_OUT: dir,
					WORLD_SOAK_MINUTES: String(minutes),
					WORLD_SOAK_SPEED: String(speed),
				},
			},
		);
	} catch {
		/* the verdict below says why */
	}
	const file = join(dir, 'samples.json');
	return existsSync(file)
		? JSON.parse(readFileSync(file, 'utf8')).verdict
		: null;
}

if (!leak) {
	const verdict = soak(out);
	console.log(`\nWorld soak: ${join(out, 'report.md')}`);
	process.exit(verdict?.ok ? 0 : 1);
}

const originals = new Map();
const restore = () => {
	for (const [path, text] of originals) writeFileSync(path, text);
	originals.clear();
};
for (const sig of ['SIGINT', 'SIGTERM'])
	process.on(sig, () => {
		restore();
		process.exit(130);
	});

const results = [];
for (const [id, what, file, from, to, metric] of LEAKS) {
	if (leak !== 'all' && leak !== id) continue;
	const path = `${web}${world}${file}`;
	const text = readFileSync(path, 'utf8');
	let verdict = 'stale';
	if (text.includes(from)) {
		originals.set(path, text);
		writeFileSync(path, text.replace(from, to));
		try {
			const v = soak(join(out, id));
			verdict = !v
				? 'broke'
				: v.failures.some((f) => f.startsWith(metric))
					? 'caught'
					: 'SURVIVED';
		} finally {
			restore();
		}
	}
	results.push({ id, what, verdict });
	console.log(`${verdict.padEnd(8)} ${id.padEnd(10)} ${what}`);
}
const bad = results.filter((r) => r.verdict !== 'caught');
const summary = `${results.length - bad.length}/${results.length} caught`;
console.log(`\n${summary}`);
mkdirSync(out, { recursive: true });
writeFileSync(
	join(out, 'leaks.md'),
	`# World soak leaks\n\n${summary} in ${minutes} simulated minutes at ${speed}×\n\n| leak | verdict |\n|---|---|\n${results.map((r) => `| ${r.what} | ${r.verdict} |`).join('\n')}\n`,
);
process.exit(bad.length ? 1 : 0);
