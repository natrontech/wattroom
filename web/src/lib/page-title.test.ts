import { describe, expect, it } from 'vitest';
import { scanSource, stale, type Allowlist } from './source-scan.test-helper';

/**
 * A page says its own name through `page-title`, and an OBJECT — a crew, a
 * channel, a rider, a ride — through `page-title-sm` (#1697, #2006, #2178). The
 * utilities own the size, so an h1 that retypes one renders a step away from
 * every other page, which is how four sidebar rows ended up a size smaller
 * than Home before anyone noticed. Seven object titles used to live in the
 * allowlist below with their reasons; `page-title-sm` is that reason, spelled
 * once. What is left is what is neither.
 */
const ALLOWLIST: Allowlist = {
	'routes/(app)/dev/':
		'dev-only galleries: mocks of other surfaces, drawn at those surfaces’ sizes',
	'routes/+error.svelte':
		'the error page speaks quietly — its headline is deliberately below page size',
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
				'class="page-title" — or "page-title-sm" when the h1 titles a thing ' +
				'rather than the page (app.css).',
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
