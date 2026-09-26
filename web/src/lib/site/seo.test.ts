import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SITE_PAGES } from './pages';
import { RIVALS } from './rivals';
import { jsonLd, siteGraph } from './seo';

const SITE = join(import.meta.dirname, '../../routes/(site)');

/** Every page under (site), as its URL — [rival] spelled out per rival. */
function sitePaths(dir = SITE): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) found.push(...sitePaths(path));
		else if (entry === '+page.svelte') {
			const url = `/${relative(SITE, dir)}`.replace(/\/$/, '') || '/';
			found.push(
				...(url.includes('[rival]')
					? RIVALS.map((r) => url.replace('[rival]', r.slug))
					: [url]),
			);
		}
	}
	return found;
}

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

	// A page missing here is missing from the sitemap, which is how search
	// finds the pages nothing links to yet.
	it('lists every (site) page in the sitemap, and nothing else', () => {
		expect(SITE_PAGES.map((p) => p.path).sort()).toEqual(sitePaths().sort());
	});

	it('keeps each title and snippet within what Google shows', () => {
		for (const page of SITE_PAGES) {
			expect(page.title.length, page.path).toBeLessThanOrEqual(65);
			expect(page.description.length, page.path).toBeLessThanOrEqual(160);
		}
		const titles = SITE_PAGES.map((p) => p.title);
		expect(new Set(titles).size).toBe(titles.length);
	});

	// Every page carries the icons search can use — the prerendered ones too,
	// which the server's og meta never reaches. A PNG at a stable path: Google
	// takes no SVG and drops an icon whose URL moves (#2136).
	it('gives every page an icon search can use', () => {
		const shell = readFileSync(
			join(import.meta.dirname, '../../app.html'),
			'utf8',
		);
		for (const tag of [
			'<link rel="icon" href="/favicon.png" sizes="192x192" type="image/png" />',
			'<link rel="apple-touch-icon" href="/favicon.png" />',
			'<meta name="theme-color" content="#0a0118" />',
		])
			expect(shell).toContain(tag);
	});
});
