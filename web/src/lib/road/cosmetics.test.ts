import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What a rider wears never moves them (#3155): the pace model — and race
 * physics, once it has files of its own — must not reach $lib/wardrobe, not
 * even through another module. The whole import graph is walked, the way the
 * server's guard reads the hub's with `go list -deps`.
 */
const LIB = join(import.meta.dirname, '..');
const IMPORT =
	/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(?\s*['"]([^'"]+)['"]/g;
const EXTENSIONS = ['', '.ts', '.svelte.ts', '.js', '/index.ts', '.svelte'];

function resolve(from: string, spec: string): string | null {
	const base = spec.startsWith('$lib/')
		? join(LIB, spec.slice(5))
		: spec.startsWith('.')
			? join(dirname(from), spec)
			: null; // a package: not ours to walk
	if (!base) return null;
	for (const ext of EXTENSIONS) {
		const file = base + ext;
		if (existsSync(file) && statSync(file).isFile()) return file;
	}
	return null;
}

function reach(entry: string): Set<string> {
	const seen = new Set<string>();
	const stack = [entry];
	while (stack.length > 0) {
		const file = stack.pop()!;
		if (seen.has(file)) continue;
		seen.add(file);
		for (const m of readFileSync(file, 'utf8').matchAll(IMPORT)) {
			const next = resolve(file, m[1] ?? m[2]);
			if (next) stack.push(next);
		}
	}
	return seen;
}

function filesUnder(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { recursive: true, encoding: 'utf8' })
		.map((f) => join(dir, f))
		.filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f));
}

const MOVERS = [join(LIB, 'road', 'pace.ts'), ...filesUnder(join(LIB, 'race'))];

describe('cosmetics never move anybody (#3155)', () => {
	it.each(MOVERS.map((f) => relative(LIB, f)))(
		'%s never reaches $lib/wardrobe',
		(file) => {
			const reached = [...reach(join(LIB, file))].map((f) => relative(LIB, f));
			expect(reached.filter((f) => f.startsWith('wardrobe/'))).toEqual([]);
		},
	);
});
