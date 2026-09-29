import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';
import { code, FILES } from '$lib/source-scan.test-helper';

/**
 * three.js is ~140 KB gzip, and only the ride world needs it (#3021). It
 * stays out of the eager shell by two rules, read from source because a
 * bundle that grew would still render:
 *
 * 1. only `lib/world/` imports `three`;
 * 2. from outside `lib/world/`, a module that reaches three is imported
 *    dynamically — `import('$lib/world/World.svelte')` — never statically.
 *    Type-only imports are erased and pass; three-free modules (the route
 *    parser, the biome names) may be imported like any other.
 */

const SRC = join(import.meta.dirname, '..', '..');
const WORLD = 'lib/world/';

/** Static, value-carrying import and re-export specifiers. `import type` is erased. */
const STATIC =
	/\b(?:import|export)\s+(?!type\b)(?:[^'";]*?\bfrom\s*)?(['"])([^'"\n]+)\1/g;

const staticImports = (file: string) =>
	[...code(readFileSync(join(SRC, file), 'utf8')).matchAll(STATIC)].map(
		(m) => m[2],
	);
const isThree = (spec: string) => spec === 'three' || spec.startsWith('three/');

/** A specifier as a path under `src`, when it names a file in lib/world. */
function worldFile(from: string, spec: string): string | null {
	const path = spec.startsWith('$lib/')
		? `lib/${spec.slice(5)}`
		: spec.startsWith('.')
			? normalize(join(dirname(from), spec))
			: null;
	if (!path?.startsWith(WORLD)) return null;
	return (
		[path, `${path}.ts`, `${path}.svelte`].find((f) => FILES.includes(f)) ??
		null
	);
}

/** Every lib/world file that reaches three through its static imports. */
function heavyWorldFiles(): Set<string> {
	const world = FILES.filter(
		(f) => f.startsWith(WORLD) && !f.endsWith('.test.ts'),
	);
	const heavy = new Set(world.filter((f) => staticImports(f).some(isThree)));
	for (let grew = true; grew;) {
		grew = false;
		for (const f of world) {
			if (heavy.has(f)) continue;
			const reaches = staticImports(f).some((s) => {
				const target = worldFile(f, s);
				return target !== null && heavy.has(target);
			});
			if (reaches) {
				heavy.add(f);
				grew = true;
			}
		}
	}
	return heavy;
}

describe('three.js stays in the world’s lazy chunk (#3021)', () => {
	it('is imported only under lib/world', () => {
		const offenders = FILES.filter((f) => !f.startsWith(WORLD)).flatMap((f) =>
			staticImports(f)
				.filter(isThree)
				.map((s) => `  ${f}: ${s}`),
		);
		expect(
			offenders,
			`three imported outside lib/world:\n${offenders.join('\n')}\n` +
				'Put the three.js code in lib/world and reach it through a dynamic import.',
		).toEqual([]);
	});

	it('is reached from outside lib/world only through a dynamic import', () => {
		const heavy = heavyWorldFiles();
		expect(heavy).toContain('lib/world/scene.ts'); // or this proves nothing
		const offenders = FILES.filter((f) => !f.startsWith(WORLD)).flatMap((f) =>
			staticImports(f)
				.map((s) => worldFile(f, s))
				.filter((t): t is string => t !== null && heavy.has(t))
				.map((t) => `  ${f} → ${t}`),
		);
		expect(
			offenders,
			`Static imports that pull three.js into the importer's chunk:\n${offenders.join('\n')}\n` +
				"Load it with import('$lib/world/World.svelte') instead, as routes/(app)/dev/world does.",
		).toEqual([]);
	});
});
