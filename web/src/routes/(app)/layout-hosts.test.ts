import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { code } from '$lib/source-scan.test-helper';

/**
 * Every branch of the root layout that draws a page draws the toast host
 * (#2406). The host lived in the framed branch alone, so on `/login`, a
 * signed-in `/`, `/hud` and every `/dev` mock a `toasts.push` wrote to a store
 * nothing drew — no error, no log, and an undo toast (#1961 made those wait)
 * waiting for a rider who could never see it. The other hosts sit below the
 * branches; this one stays inside them because it is also a tab stop, and
 * the framed branch keeps it right after the skip link (#1961).
 */
const layout = code(
	readFileSync(join(import.meta.dirname, '+layout.svelte'), 'utf8'),
);

/** The top-level branches of the chain that decides what the page is. */
function branches(source: string): string[] {
	const start = source.search(/^\{#if !account\.loaded/m);
	const end = source.indexOf('\n{/if}', start);
	return source.slice(start, end).split(/^\{:else/m);
}

describe('the root layout (#2406)', () => {
	const drawing = branches(layout).filter((b) =>
		b.includes('{@render children()}'),
	);

	it('has page-drawing branches to check', () => {
		expect(drawing.length).toBeGreaterThanOrEqual(2);
	});

	it.each(drawing.map((b, i) => [i, b] as const))(
		'branch %i draws the toast host',
		(_, branch) => {
			expect(branch).toContain('<Toasts />');
		},
	);
});
