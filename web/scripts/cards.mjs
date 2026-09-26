// Share cards for the public pages, run first by `make screenshots`.
//
// Shoots the dev-only /dev/card route (web/src/routes/(app)/dev/card) for
// every page the sitemap lists — so a new public page gets its card without
// touching this file — into web/static/cards/<name>.png at 1200x630, the
// og:image each page's head names (seo.ts cardName; seo.test.ts fails on a
// page with no card). Also GitHub's social preview, 1280x640, into
// docs/assets/social-preview.png: that one is uploaded by hand (LAUNCH.md §5).
//
// PNG, not WebP: Slack and Discord previews do not reliably take WebP.
// Reduced motion, so the hero's numbers hold still and a rerun draws the
// same card.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = process.env.WATTROOM_DEV_WEB_PORT;
if (!PORT) {
	console.error(
		'WATTROOM_DEV_WEB_PORT is unset — run through `make screenshots`.',
	);
	process.exit(1);
}
const BASE = `http://localhost:${PORT}`;
const CARDS = fileURLToPath(new URL('../static/cards/', import.meta.url));
const SOCIAL = fileURLToPath(
	new URL('../../docs/assets/social-preview.png', import.meta.url),
);

const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
const paths = [
	...sitemap.matchAll(/<loc>https?:\/\/[^/<]+(\/[^<]*)<\/loc>/g),
].map((m) => m[1]);
if (paths.length === 0) throw new Error(`no pages in ${BASE}/sitemap.xml`);

/** seo.ts cardName, spelled the same way. */
const cardName = (path) =>
	path === '/' ? 'home' : path.slice(1).replaceAll('/', '-');

mkdirSync(CARDS, { recursive: true });
const browser = await chromium.launch();
try {
	const page = await browser.newPage({
		viewport: { width: 1400, height: 900 },
		reducedMotion: 'reduce',
	});
	const shoot = async (path, w, h, file) => {
		const q = new URLSearchParams({ path, w: String(w), h: String(h) });
		await page.goto(`${BASE}/dev/card?${q}`);
		const card = page.locator('#card');
		await card.waitFor();
		await page.evaluate(() => document.fonts.ready);
		await card.screenshot({ path: file, type: 'png' });
		console.log(`  ${file}`);
	};
	for (const path of paths)
		await shoot(path, 1200, 630, `${CARDS}${cardName(path)}.png`);
	await shoot('/', 1280, 640, SOCIAL);
} finally {
	await browser.close();
}
