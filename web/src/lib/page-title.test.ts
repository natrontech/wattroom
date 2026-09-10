import { describe, expect, it } from 'vitest';
import { scanSource, stale, type Allowlist } from './source-scan.test-helper';

/**
 * A page says its own name through `page-title` (#1697, #2006). The utility
 * owns the size, so an h1 that retypes one renders a step away from every
 * other page — which is how four sidebar rows ended up a size smaller than
 * Home before anyone noticed. Below is every h1 that is deliberately not a
 * page's title, each with its reason: before adding a line, ask whether the
 * h1 names the page. If it does it takes `page-title`, with the extras (a
 * margin, `truncate`) beside it.
 */
const ALLOWLIST: Allowlist = {
	'routes/dev/':
		'dev-only galleries: mocks of other surfaces, drawn at those surfaces’ sizes',
	'routes/+error.svelte':
		'the error page speaks quietly — its headline is deliberately below page size',
	'routes/r/[slug]/+layout.svelte':
		"the room's name in the room chrome, sized to the column it sits in",
	'routes/u/[id]/+page.svelte':
		'the rider, not the page: a display name set beside its avatar',
	'routes/crew/[id]/+page.svelte':
		'the crew, not the page — and it truncates to the header',
	'routes/c/[code]/+page.svelte':
		'the crew an invite names, inside the invite card',
	'routes/history/[id]/+page.svelte': 'one ride, titled inside its own header',
	'lib/ride/PreRide.svelte': 'the workout about to start, on the pre-ride card',
	'lib/ride/SessionSummary.svelte':
		'the session just finished, titled inside the summary',
};

/** `<h1 …class="… text-2xl …">`, attributes wrapped across lines included. */
const HAND_ROLLED = /<h1\b[^>]*\bclass="[^"]*\btext-(?:xl|2xl|3xl)\b[^"]*"/gs;

describe('one spelling for a page title (#2006)', () => {
	it('never retypes the size on an h1', () => {
		const { offenders } = scanSource(HAND_ROLLED, ALLOWLIST);
		expect(
			offenders,
			`h1s carrying their own size instead of \`page-title\`:\n${offenders.join('\n')}\n` +
				'Replace the font-display/text-*/font-bold/tracking-tight spelling with ' +
				'class="page-title" (app.css) — or, when the h1 titles a thing rather than ' +
				'the page, add the file to ALLOWLIST in page-title.test.ts with its reason.',
		).toEqual([]);
	});

	it('keeps no allowlist entry that excuses nothing', () => {
		const dead = stale(ALLOWLIST, scanSource(HAND_ROLLED, ALLOWLIST).used);
		expect(
			dead,
			`ALLOWLIST entries with nothing left to excuse — delete them:\n  ${dead.join('\n  ')}`,
		).toEqual([]);
	});
});
