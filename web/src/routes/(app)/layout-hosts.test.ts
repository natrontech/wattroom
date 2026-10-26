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

/**
 * The menu, rider card, confirm and toast hosts mount outside the frame that
 * wears `data-ride` while riding (#3788), so they sit in wrappers that mark
 * the ride themselves. Neither the frame nor a wrapper forces a scheme: a
 * ride keeps the rider's (Jan, 2026-10-25, #4160), where the cave turned the
 * whole app dark the moment a session started.
 */
describe('the overlay hosts while riding (#3788, #4160)', () => {
	const rideWrapped = (inner: string) =>
		new RegExp(
			`<div class="contents" data-ride=\\{riding \\? '' : undefined\\}>\\s*${inner}\\s*</div>`,
		);

	it('mount inside a wrapper that marks the ride', () => {
		expect(layout).toMatch(
			rideWrapped(
				'<ContextMenuHost \\{riding\\} />\\s*<RiderCardHost />\\s*<ConfirmHost />',
			),
		);
	});

	it('wraps the framed toast host too, still right after the skip link', () => {
		const framed = branches(layout).find((b) => b.includes('Skip to the page'));
		expect(framed).toMatch(rideWrapped('<Toasts />'));
	});

	it('marks the frame itself, and darkens nothing for the ride', () => {
		expect(layout).toMatch(
			/<div\s+class="safe-frame flex h-dvh overflow-hidden"\s+data-ride=\{riding \? '' : undefined\}/,
		);
		// No `cave` class, spelled in the attribute or in a class expression.
		expect(layout).not.toMatch(/class="[^"]*\bcave\b/);
		expect(layout).not.toMatch(/'[^'\n]*\bcave\b[^'\n]*'/);
	});
});

// A crew session held no wake lock, so the screen and the Mac slept mid-ride
// (#4219): the layout holds one for any ride on a channel, on every page,
// not only the ride's own (`riding` above is the frame's, page-bound).
describe('the wake lock', () => {
	it('is held for every ride on a channel, wherever the rider reads', () => {
		expect(layout).toMatch(
			/keepAwakeWhile\(\(\) => !!channelConnection\.current\?\.riding\(\)\)/,
		);
	});
});
