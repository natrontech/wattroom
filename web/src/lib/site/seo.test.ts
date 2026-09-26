import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jsonLd, LANDING, siteIdentity, SITE_PAGES } from './seo';

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
		expect(siteIdentity()).toMatchObject({
			'@type': 'WebSite',
			name: 'WattRoom',
			url: 'https://wattroom.ch/',
		});
	});

	it('keeps each search snippet within what Google shows', () => {
		for (const page of SITE_PAGES) {
			expect(page.description.length, page.path).toBeLessThanOrEqual(160);
			expect(page.path, page.path).toMatch(/^\/[a-z0-9-]*$/);
		}
		expect(SITE_PAGES[0]).toBe(LANDING);
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
