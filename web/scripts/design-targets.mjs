// Re-render the design targets from their mockups: `make design-targets`.
//
// Serves docs/design/mockups on a free port and screenshots, at 1440 wide
// with reduced motion:
//   v2, v3  every <section class="mock" id> of the page → v2-<id>.png, v3-<id>.png
//   shop    the catalogue, the locker and the makers views → shop-*.png
//   world   copies of the mocks' own world renders → world-*.jpg
// into docs/design/targets/, or --out <dir>. Name mocks to render only those:
// `node web/scripts/design-targets.mjs v2`. Commit a re-render only when its
// mock changed — a render drifts a pixel between runs, and the images are the
// record of what Jan chose (docs/design/TARGETS.md).
//
// The mocks load their fonts and three.js from CDNs, so this needs a network.
import { chromium } from '@playwright/test';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(
	new URL('../../docs/design/mockups/', import.meta.url),
);
const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const OUT =
	outAt >= 0
		? args[outAt + 1]
		: fileURLToPath(new URL('../../docs/design/targets/', import.meta.url));
const named = args.filter(
	(a, i) => !a.startsWith('--') && args[i - 1] !== '--out',
);
const want = (mock) => !named.length || named.includes(mock);

const WORLD = {
	'world-bluehour-hairpin.jpg': 'v2/shots/bluehour-hairpin.jpg',
	'world-ghost.jpg': 'v3/shots/ghost-km12.jpg',
	'world-kom.jpg': 'v3/shots/kom-gurnigel.jpg',
	'world-realism-tier3.jpg': 'v3/shots/realterrain-t3.jpg',
};
const SHOP = {
	shop: 'shop-catalogue',
	locker: 'shop-locker',
	brands: 'shop-makers',
};

await mkdir(OUT, { recursive: true });
const types = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.json': 'application/json',
	'.jpg': 'image/jpeg',
	'.png': 'image/png',
};
const server = createServer(async (req, res) => {
	try {
		const path = join(
			ROOT,
			decodeURIComponent(new URL(req.url, 'http://x').pathname),
		);
		if (!path.startsWith(ROOT)) throw new Error('outside the mockups');
		const body = await readFile(path);
		res.writeHead(200, {
			'content-type': types[extname(path)] ?? 'application/octet-stream',
		});
		res.end(body);
	} catch {
		res.writeHead(404);
		res.end();
	}
}).listen(0, '127.0.0.1');
await new Promise((ok) => server.once('listening', ok));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
	args: process.platform === 'darwin' ? ['--use-angle=metal'] : [],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.emulateMedia({ reducedMotion: 'reduce' });
try {
	for (const mock of ['v2', 'v3'].filter(want)) {
		await page.goto(`${base}/${mock}/index.html`);
		await page.waitForTimeout(2500);
		const ids = await page
			.locator('section.mock[id]')
			.evaluateAll((sections) => sections.map((s) => s.id));
		for (const id of ids) {
			const section = page.locator(`section#${id}`);
			await section.scrollIntoViewIfNeeded();
			await page.waitForTimeout(400);
			await section.screenshot({ path: join(OUT, `${mock}-${id}.png`) });
			console.log('target', `${mock}-${id}`);
		}
	}
	if (want('shop'))
		for (const [view, name] of Object.entries(SHOP)) {
			await page.goto(`${base}/shop/index.html#${view}`);
			// The locker and makers draw their riders in three.js; nine seconds
			// is what the slowest thumbnail took to settle.
			await page.waitForTimeout(9000);
			await page.screenshot({ path: join(OUT, `${name}.png`) });
			console.log('target', name);
		}
	if (want('world'))
		for (const [name, from] of Object.entries(WORLD)) {
			await copyFile(join(ROOT, from), join(OUT, name));
			console.log('target', name.replace(/\.jpg$/, ''));
		}
} finally {
	await browser.close();
	server.close();
}
