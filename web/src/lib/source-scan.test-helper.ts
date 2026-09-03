import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * How the guard tests read `src` (#400, #458): one list of source files, one
 * way to blank comments, one way to say "this file is excused, and here is
 * why". Test-only — it reaches for node:fs and nothing in the app imports it.
 */

const SRC = join(import.meta.dirname, '..');

/** Every source file under `src`, as a path relative to it. */
export const FILES = readdirSync(SRC, { recursive: true })
	.map(String)
	.filter((file) => /\.(svelte|ts|css)$/.test(file));

/**
 * An allowlist maps a rule to the reason it exists. Keys are relative to
 * `src`: an exact file, a `dir/` prefix, or `*.suffix`.
 */
export type Allowlist = Record<string, string>;

/** Blank comments, keeping newlines: `#280` in a comment is an issue, not a colour. */
export function code(source: string): string {
	return source.replace(
		/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|(?<=^|\s)\/\/.*$/gm,
		(comment) => comment.replace(/[^\n]/g, ' '),
	);
}

function allowedBy(allowlist: Allowlist, file: string): string | undefined {
	return Object.keys(allowlist).find((rule) =>
		rule.startsWith('*')
			? file.endsWith(rule.slice(1))
			: rule.endsWith('/')
				? file.startsWith(rule)
				: file === rule,
	);
}

/** Every match of `pattern` in `src`, split into offenders and the rules that excused the rest. */
export function scan(
	pattern: RegExp,
	allowlist: Allowlist,
	skip?: RegExp,
): { offenders: string[]; used: Set<string> } {
	const offenders: string[] = [];
	const used = new Set<string>();
	for (const file of FILES) {
		const rule = allowedBy(allowlist, file);
		code(readFileSync(join(SRC, file), 'utf8'))
			.split('\n')
			.forEach((line, i) => {
				for (const m of line.matchAll(pattern)) {
					if (skip?.test(line.slice(0, m.index))) continue;
					if (rule) used.add(rule);
					else offenders.push(`  ${file}:${i + 1}  ${m[0]}`);
				}
			});
	}
	return { offenders, used };
}

/** Allowlist rules that excused nothing — entries to delete. */
export function stale(allowlist: Allowlist, used: Set<string>): string[] {
	return Object.keys(allowlist).filter((rule) => !used.has(rule));
}
