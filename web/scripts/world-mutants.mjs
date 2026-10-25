#!/usr/bin/env node
// The world's mutants (#3222): re-inject each way the generator has gone wrong
// and confirm a gate in src/lib/world goes red, then restore. Exits 1 if any
// mutant survives or its text is gone ("stale": rewrite it against the code it
// was meant to break, never delete it to go green). Advisory in CI, about
// 20 minutes. The route-keyed toy worlds (#3226) mutate inside their own test
// (place/shared.test.ts), which this runs first.
//
//   node scripts/world-mutants.mjs               every mutant
//   node scripts/world-mutants.mjs along fog     just those, by id
//   node scripts/world-mutants.mjs --report out.md
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));
const dir = 'src/lib/world/';

// [id, what breaks, file under src/lib/world/, [from, to] pairs — each `from` replaced everywhere]
// prettier-ignore
const MUTANTS = [
	['along', "'along' rounded to the step", 'setpieces-stroke.ts', [['\t\t\t\t\t\t\talong: at,', '\t\t\t\t\t\t\talong: Math.round(at / 10) * 10,']]],
	['centre-clearance', 'clearance measured from the footprint centre', 'placement/rules.ts', [['polygonPolyline(poly, road.points) - road.halfWidth', 'polygonPolyline([centroid(poly)], road.points) - road.halfWidth']]],
	['constant-sink', 'every kit model sunk by one constant', 'props/placer.ts', [[': Math.max(lo, hi - bury);', ': lo - 0.3;']]],
	['two-fog', 'the scene fog and the ground shader disagree', 'fog.ts', [['propFogDensity = (fogK: number) => fogK;', 'propFogDensity = (fogK: number) => fogK * 2.5;']]],
	['near-0.1', 'camera near plane 0.1 m', 'camera.ts', [['near: 1,', 'near: 0.1,']]],
	['lod-props-no-hysteresis', 'props tiles leave their ring at the radius they enter', 'props/batch.ts', [['held ? d <= r * LEAVE : d < r', 'held ? d <= r : d < r']]],
	['lod-ground-no-hysteresis', 'ground chunks leave at the radius they enter', 'ground-stream.ts', [['export const LEAVE = 1.1;', 'export const LEAVE = 1;']]],
	['math-random', 'Math.random in placement', 'setpieces-stroke.ts', [['unit(key(stroke, slot, d));', 'Math.random();']]],
	['emissive', 'an emissive world material', 'materials.ts', [['new THREE.MeshToonMaterial({ vertexColors: true, gradientMap })', 'new THREE.MeshToonMaterial({ vertexColors: true, gradientMap, emissive: 0x222222 })']]],
	['furniture-ridden-road-only', 'furniture checked against the ridden road only', 'props/placer.ts', [['alone(p, near(x, z), ground)', 'alone(p, near(x, z).slice(0, 1), ground)']]],
	['uphill-pace-spacing', "a kind's spacing measured at the uphill pace only", 'setpieces-stroke.ts', [['r.fast(', 'r.up(']]],
	['seed-name-length', 'a stroke seeded from its name and length', 'setpieces-stroke.ts', [['const stroke = hashOf(line.key);', 'const stroke = hashOf(`${line.key}:${line.x.length}`);']]],
	['hairpins-from-start', 'hairpins numbered from the route start', 'setpieces-stroke.ts', [['[`${inside.length - n}`]', '[`${n + 1}`]']]],
	['pass-name-stream', 'a pass name drawn from a stream', 'setpieces.ts', [['1,\n\t\t\t\t),\n\t\t\t),\n\t\t);', '1 + ((globalThis.__n = (globalThis.__n ?? 0) + 1) | 0),\n\t\t\t\t),\n\t\t\t),\n\t\t);']]],
	['region-world-cells', 'a private region keyed in world cells', 'place/region.ts', [['if (region)\n\t\treturn keyed(', 'if (false && region)\n\t\treturn keyed(']]],
	['region-world-secret', "a private region keyed with the world's secret", 'place/region.ts', [['\t\t\tregion.salt,\n', '\t\t\tkeying.salt,\n']]],
	['utm-tile-local', 'UTM keyed in a tile-local frame', 'place/project.ts', [['return [500000 + K0 * A_ * e, (south ? 10000000 : 0) + K0 * A_ * n];', 'return [(500000 + K0 * A_ * e) % 5000, ((south ? 10000000 : 0) + K0 * A_ * n) % 5000];']]],
	['flagpole-low', 'an 8 m flagpole in the low, unfaded set', 'props/batch.ts', [["\tflag0: 'buildings',", "\tflag0: 'stock',"]]],
	['unbanked-furniture', 'chalk laid flat across a banked road', 'chalk.ts', [['across(BESIDE, bank)', 'across(BESIDE, 0)'], ["p.heading + Math.PI, bank, 'YXZ'", "p.heading + Math.PI, 0, 'YXZ'"]]],
	['rigid-fence', 'a rigid 10 m fence measured at its corners only', 'placement/rules.ts', [["['base', samples(p.footprint)],", "['base', p.footprint],"]]],
	['salt-in-bundle', 'a salt compiled into the bundle', 'place/keyed.ts', [['const p = prefix(salt, kind);', 'const p = prefix([0x57a770e0, 0x0de5a1e0, 0x5eed5eed, 0x00c0ffee], kind);']]],
];

const args = process.argv.slice(2);
const at = args.indexOf('--report');
const report = at >= 0 ? args.splice(at, 2)[1] : null;

const run = () => {
	try {
		execFileSync('pnpm', ['exec', 'vitest', 'run', dir], {
			cwd: web,
			stdio: 'pipe',
			timeout: 300_000,
		});
		return true;
	} catch {
		return false;
	}
};

// A loaded machine can time a test out once: the baseline gets a second try.
if (!run() && !run()) {
	console.error('The world tests fail before any mutant: fix that first.');
	process.exit(1);
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
for (const [id, what, file, edits] of MUTANTS) {
	if (args.length && !args.includes(id)) continue;
	const path = `${web}${dir}${file}`;
	const text = readFileSync(path, 'utf8');
	let next = text;
	const stale = edits.some(([from]) => !next.includes(from));
	for (const [from, to] of edits) next = next.replaceAll(from, to);
	let verdict = 'stale';
	if (!stale) {
		originals.set(path, text);
		writeFileSync(path, next);
		try {
			verdict = run() ? 'SURVIVED' : 'caught';
		} finally {
			restore();
		}
	}
	results.push({ id, what, verdict });
	console.log(`${verdict.padEnd(8)} ${id.padEnd(28)} ${what}`);
}
const bad = results.filter((r) => r.verdict !== 'caught');
const summary = `${results.length - bad.length}/${results.length} caught`;
console.log(`\n${summary}`);
if (report)
	writeFileSync(
		report,
		`# World mutants\n\n${summary}\n\n| mutant | verdict |\n|---|---|\n${results.map((r) => `| ${r.what} | ${r.verdict} |`).join('\n')}\n`,
	);
process.exit(bad.length ? 1 : 0);
