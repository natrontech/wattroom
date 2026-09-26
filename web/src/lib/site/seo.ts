/**
 * What the public pages say about themselves to search, link previews and
 * AI crawlers (ADR-0061). They are prerendered at build time, so every build
 * names wattroom.ch — a self-hoster's too: the words are the project's, and a
 * copy on another host should point search back at the original rather than
 * compete with it. The app's own routes get their meta from the server
 * (server/internal/og), which knows the host it runs on.
 */
export const SITE_ORIGIN = 'https://wattroom.ch';
export const SITE_NAME = 'WattRoom';
export const REPO = 'https://github.com/natrontech/wattroom';

/** The card a page without its own shows — drawn by the server (og.go). */
export const DEFAULT_IMAGE = `${SITE_ORIGIN}/og/default.png`;

/** A public page, as the sitemap and its own head describe it. */
export type SitePage = {
	path: string;
	title: string;
	description: string;
};

export const LANDING: SitePage = {
	path: '/',
	title: 'WattRoom — train together, not alone',
	// Google shows about 155 characters. The second sentence is WATTROOM.md's
	// own positioning: "Zwift alternative", "structured workouts" and "smart
	// trainer" are what a rider types into a search box (#2139).
	description:
		'Discord for indoor cycling — no virtual world, your watts are the game. A Zwift alternative for structured workouts and smart-trainer rides with friends.',
};

/** Every prerendered page, in the order the sitemap lists them. */
export const SITE_PAGES: readonly SitePage[] = [LANDING];

/**
 * The home page's WebSite node: what Google's site-names feature reads to
 * label a result "WattRoom" rather than "wattroom.ch", and it looks at the
 * root alone. The publisher is there because the word is not ours alone — an
 * unrelated studio shares it, and sameAs pins this one to its repository.
 */
export function siteIdentity(): Record<string, unknown> {
	return {
		'@context': 'https://schema.org',
		'@type': 'WebSite',
		name: SITE_NAME,
		url: `${SITE_ORIGIN}/`,
		description: LANDING.description,
		publisher: {
			'@type': 'Organization',
			name: SITE_NAME,
			url: `${SITE_ORIGIN}/`,
			logo: `${SITE_ORIGIN}/favicon.png`,
			sameAs: [REPO],
		},
	};
}

/**
 * A JSON-LD document as the text of a script element. JSON.stringify leaves
 * `<` alone, so a "</script>" anywhere in a string would close the element
 * early; escaped, it is the same JSON and cannot.
 */
export function jsonLd(doc: unknown): string {
	return JSON.stringify(doc)
		.replaceAll('<', '\\u003c')
		.replaceAll('>', '\\u003e')
		.replaceAll('&', '\\u0026');
}
