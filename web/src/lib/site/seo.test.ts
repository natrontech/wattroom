import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SITE_PAGES } from './pages';
import { cardName, jsonLd, siteGraph } from './seo';

describe('the public pages’ head (ADR-0061)', () => {
	it('cannot close its own script element', () => {
		const text = jsonLd({ name: '</script><script>alert(1)</script>' });
		expect(text).not.toContain('</script>');
		expect(JSON.parse(text)).toEqual({
			name: '</script><script>alert(1)</script>',
		});
	});

	// Google's site-names feature reads the root's WebSite node, and nothing
	// else labels a result "WattRoom" instead of "wattroom.ch" (#2136).
	it('names the site at the root', () => {
		const graph = (siteGraph() as { '@graph': Record<string, unknown>[] })[
			'@graph'
		];
		expect(graph.find((n) => n['@type'] === 'WebSite')).toMatchObject({
			name: 'WattRoom',
			url: 'https://wattroom.ch/',
		});
	});

	// The card is what a shared link shows — on X, the only thing it shows.
	// A page naming one that is not in the build previews as a broken image.
	it('has a share card for every page', () => {
		const cards = join(import.meta.dirname, '../../../static/cards');
		const missing = SITE_PAGES.map(cardName).filter(
			(name) => !existsSync(join(cards, `${name}.png`)),
		);
		expect(missing, 'run `make screenshots`').toEqual([]);
	});

	it('keeps each title and snippet within what Google shows', () => {
		for (const page of SITE_PAGES) {
			expect(page.title.length, page.path).toBeLessThanOrEqual(65);
			expect(page.description.length, page.path).toBeLessThanOrEqual(160);
		}
		const titles = SITE_PAGES.map((p) => p.title);
		expect(new Set(titles).size).toBe(titles.length);
	});
});
