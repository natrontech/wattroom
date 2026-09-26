import { SITE_ORIGIN, SITE_PAGES } from '$lib/site/seo';

// Written at build time like the pages it lists (ADR-0061). The app's routes
// are a rider's and stay out of it — robots.txt says the same.
export const prerender = true;

export function GET(): Response {
	const urls = SITE_PAGES.map(
		(p) => `\t<url><loc>${SITE_ORIGIN}${p.path}</loc></url>`,
	).join('\n');
	return new Response(
		`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
		{ headers: { 'Content-Type': 'application/xml' } },
	);
}
